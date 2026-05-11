"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  creditCardInvoice,
  financialAccount,
  importPendingPayment,
  importSession,
  transaction,
} from "@/db/schema/finance";
import { periodForDate } from "@/lib/credit-card";
import { parseDescription } from "@/lib/import/description-parser";
import { getAutoApplyCategoryId } from "@/lib/repos/category-suggestions";
import { requireOrganization } from "@/lib/guards";
import { canEdit, getMemberRole } from "@/lib/auth-permissions";

const txSchema = z.object({
  externalId: z.string().nullable(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  kind: z.enum(["income", "expense"]),
  description: z.string().min(1).max(500),
  installmentNumber: z.number().int().min(1).max(48).nullable().optional(),
  installmentTotal: z.number().int().min(1).max(48).nullable().optional(),
  isPaymentReceived: z.boolean().optional(),
});

const newBankSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(["checking", "savings"]),
  initialBalance: z
    .string()
    .regex(/^-?\d+(\.\d{1,2})?$/)
    .optional()
    .or(z.literal("")),
  bankName: z.string().max(80).optional().or(z.literal("")),
  bankId: z.string().max(20).optional().or(z.literal("")),
  accountNumber: z.string().max(40).optional().or(z.literal("")),
  accountBranch: z.string().max(20).optional().or(z.literal("")),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
});

const newCardSchema = z.object({
  name: z.string().min(1).max(80),
  closingDay: z.coerce.number().int().min(1).max(31),
  dueDay: z.coerce.number().int().min(1).max(31),
  creditLimit: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional()
    .or(z.literal("")),
  bankName: z.string().max(80).optional().or(z.literal("")),
  bankId: z.string().max(20).optional().or(z.literal("")),
  accountNumber: z.string().max(40).optional().or(z.literal("")),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
});

const baseSchema = z.object({
  source: z.enum(["ofx", "csv"]),
  accountKind: z.enum(["bank", "credit_card"]),
  filename: z.string().max(200).optional().or(z.literal("")),
  periodStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  periodEnd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  mode: z.enum(["existing", "new"]),
  accountId: z.string().uuid().optional().or(z.literal("")),
  transactions: z.string().min(2),
  /**
   * Quando "on", apaga transações existentes desta conta cujos externalIds
   * estão neste arquivo, e refaz o cálculo da fatura/período. Usar pra
   * corrigir imports antigos que ficaram com período/fatura erradas.
   */
  reimport: z.string().optional().or(z.literal("")),
});

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Calcula uma due_date plausível para um periodEnd dado, usando dueDay do cartão.
 * Mantém a regra antiga de periodForDate: se dueDay < closingDay, due cai no
 * mês seguinte; caso contrário, no mesmo mês do periodEnd.
 */
function deriveDueDate(
  periodEndIso: string,
  closingDay: number,
  dueDay: number,
): string {
  const [y, m, d] = periodEndIso.split("-").map(Number);
  let dueYear = y;
  let dueMonth0 = m - 1;
  if (dueDay < closingDay) {
    dueMonth0 += 1;
    if (dueMonth0 > 11) {
      dueMonth0 = 0;
      dueYear += 1;
    }
  }
  const lastDay = new Date(dueYear, dueMonth0 + 1, 0).getDate();
  const day = Math.min(dueDay, lastDay);
  return `${dueYear}-${String(dueMonth0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export type ConfirmImportState = {
  error?: string;
  success?: {
    accountId: string;
    importSessionId: string;
    imported: number;
    duplicates: number;
    reimported: number;
    paymentsLinked: number;
    paymentsPending: number;
    accountCreated: boolean;
  };
} | null;

export async function confirmImportAction(
  _prev: ConfirmImportState,
  formData: FormData,
): Promise<ConfirmImportState> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const baseParsed = baseSchema.safeParse(Object.fromEntries(formData));
  if (!baseParsed.success) return { error: "Dados inválidos." };

  let txsRaw: unknown;
  try {
    txsRaw = JSON.parse(baseParsed.data.transactions);
  } catch {
    return { error: "Lista de transações inválida." };
  }
  const txsParsed = z.array(txSchema).safeParse(txsRaw);
  if (!txsParsed.success) {
    return { error: "Estrutura de transações inválida." };
  }
  const txs = txsParsed.data;
  if (txs.length === 0) return { error: "Nenhuma transação selecionada." };

  const accountKind = baseParsed.data.accountKind;
  let resolvedAccountId: string;
  let resolvedOwnerId: string;
  let accountCreated = false;
  let accountClosingDay: number | null = null;
  let accountDueDay: number | null = null;
  const role = await getMemberRole(orgId, userId);

  if (baseParsed.data.mode === "new") {
    if (accountKind === "credit_card") {
      const newParsed = newCardSchema.safeParse({
        name: formData.get("newName"),
        closingDay: formData.get("newClosingDay"),
        dueDay: formData.get("newDueDay"),
        creditLimit: formData.get("newCreditLimit"),
        bankName: formData.get("newBankName"),
        bankId: formData.get("newBankId"),
        accountNumber: formData.get("newAccountNumber"),
        color: formData.get("newColor"),
      });
      if (!newParsed.success) {
        return { error: "Verifique os campos do novo cartão." };
      }
      const d = newParsed.data;
      const [created] = await db
        .insert(financialAccount)
        .values({
          organizationId: orgId,
          ownerId: userId,
          name: d.name,
          type: "credit_card",
          initialBalance: "0",
          color: d.color || null,
          closingDay: d.closingDay,
          dueDay: d.dueDay,
          creditLimit: d.creditLimit || null,
          bankName: d.bankName || null,
          bankId: d.bankId || null,
          accountNumber: d.accountNumber || null,
        })
        .returning({
          id: financialAccount.id,
          closingDay: financialAccount.closingDay,
          dueDay: financialAccount.dueDay,
        });
      resolvedAccountId = created.id;
      resolvedOwnerId = userId;
      accountClosingDay = created.closingDay!;
      accountDueDay = created.dueDay!;
      accountCreated = true;
    } else {
      const newParsed = newBankSchema.safeParse({
        name: formData.get("newName"),
        type: formData.get("newType"),
        initialBalance: formData.get("newInitialBalance"),
        bankName: formData.get("newBankName"),
        bankId: formData.get("newBankId"),
        accountNumber: formData.get("newAccountNumber"),
        accountBranch: formData.get("newAccountBranch"),
        color: formData.get("newColor"),
      });
      if (!newParsed.success) {
        return { error: "Verifique os campos da nova conta." };
      }
      const d = newParsed.data;
      const [created] = await db
        .insert(financialAccount)
        .values({
          organizationId: orgId,
          ownerId: userId,
          name: d.name,
          type: d.type,
          initialBalance: d.initialBalance || "0",
          color: d.color || null,
          bankName: d.bankName || null,
          bankId: d.bankId || null,
          accountNumber: d.accountNumber || null,
          accountBranch: d.accountBranch || null,
        })
        .returning({ id: financialAccount.id });
      resolvedAccountId = created.id;
      resolvedOwnerId = userId;
      accountCreated = true;
    }
  } else {
    const accId = baseParsed.data.accountId;
    if (!accId) return { error: "Selecione uma conta de destino." };
    const [acc] = await db
      .select()
      .from(financialAccount)
      .where(
        and(
          eq(financialAccount.id, accId),
          eq(financialAccount.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!acc) return { error: "Conta de destino não encontrada." };
    if (!canEdit({ ownerId: acc.ownerId }, userId, role)) {
      return { error: "Sem permissão para importar nesta conta." };
    }
    if (accountKind === "credit_card" && acc.type !== "credit_card") {
      return { error: "Selecione um cartão de crédito como destino." };
    }
    if (accountKind === "bank" && acc.type === "credit_card") {
      return { error: "Selecione uma conta corrente, poupança ou dinheiro." };
    }
    if (accountKind === "credit_card" && (!acc.closingDay || !acc.dueDay)) {
      return { error: "Cartão sem dias de fechamento/vencimento configurados." };
    }
    resolvedAccountId = acc.id;
    resolvedOwnerId = acc.ownerId;
    accountClosingDay = acc.closingDay;
    accountDueDay = acc.dueDay;
  }

  const externalIds = txs
    .map((t) => t.externalId)
    .filter((v): v is string => !!v);

  const reimportMode = baseParsed.data.reimport === "on";
  const existingExternal = new Set<string>();

  // Usa o período do OFX como fonte da verdade pra fatura quando disponível.
  // Resolve o problema de cartões com fechamento variável (27/28) e do
  // boundary `>=` vs `>` em periodForDate.
  const ofxPeriodStart =
    accountKind === "credit_card" && baseParsed.data.periodStart
      ? baseParsed.data.periodStart
      : null;
  const ofxPeriodEnd =
    accountKind === "credit_card" && baseParsed.data.periodEnd
      ? baseParsed.data.periodEnd
      : null;
  const useOfxPeriod = !!ofxPeriodStart && !!ofxPeriodEnd;

  if (!reimportMode && externalIds.length > 0) {
    const rows = await db
      .select({ externalId: transaction.externalId })
      .from(transaction)
      .where(
        and(
          eq(transaction.organizationId, orgId),
          eq(transaction.accountId, resolvedAccountId),
          inArray(transaction.externalId, externalIds),
        ),
      );
    for (const r of rows) if (r.externalId) existingExternal.add(r.externalId);
  }

  let imported = 0;
  let duplicates = 0;
  let reimported = 0;
  let paymentsLinked = 0;
  let paymentsPending = 0;
  let importSessionId = "";
  // Faturas afetadas (precisam recalcular total ao final)
  const touchedInvoiceIds = new Set<string>();

  await db.transaction(async (tx) => {
    // Se reimport mode, apaga transações cujos externalIds estão neste arquivo.
    // As faturas afetadas são marcadas pra recalcular total ao final.
    if (reimportMode && externalIds.length > 0) {
      const oldRows = await tx
        .select({
          id: transaction.id,
          invoiceId: transaction.creditCardInvoiceId,
        })
        .from(transaction)
        .where(
          and(
            eq(transaction.organizationId, orgId),
            eq(transaction.accountId, resolvedAccountId),
            inArray(transaction.externalId, externalIds),
          ),
        );
      for (const r of oldRows) {
        if (r.invoiceId) touchedInvoiceIds.add(r.invoiceId);
      }
      if (oldRows.length > 0) {
        await tx
          .delete(transaction)
          .where(
            and(
              eq(transaction.organizationId, orgId),
              eq(transaction.accountId, resolvedAccountId),
              inArray(transaction.externalId, externalIds),
            ),
          );
        reimported = oldRows.length;
      }

      // Limpa pendências antigas com mesmos external_ids: caso contrário,
      // o reimport recriaria o "Pagamento recebido" sem ver o link existente,
      // gerando pendências fantasmas. Também desfaz a marca em transactions
      // que apontavam pra elas via external_payment_id.
      const externalPaymentIdsToFree = await tx
        .select({ externalId: importPendingPayment.externalId })
        .from(importPendingPayment)
        .where(
          and(
            eq(importPendingPayment.organizationId, orgId),
            eq(importPendingPayment.accountId, resolvedAccountId),
            inArray(importPendingPayment.externalId, externalIds),
          ),
        );
      const epids = externalPaymentIdsToFree
        .map((r) => r.externalId)
        .filter((v): v is string => !!v);
      if (epids.length > 0) {
        await tx
          .update(transaction)
          .set({ externalPaymentId: null, updatedAt: new Date() })
          .where(
            and(
              eq(transaction.organizationId, orgId),
              inArray(transaction.externalPaymentId, epids),
            ),
          );
        await tx
          .update(creditCardInvoice)
          .set({ externalPaymentId: null })
          .where(
            and(
              eq(creditCardInvoice.organizationId, orgId),
              inArray(creditCardInvoice.externalPaymentId, epids),
            ),
          );
        await tx
          .delete(importPendingPayment)
          .where(
            and(
              eq(importPendingPayment.organizationId, orgId),
              eq(importPendingPayment.accountId, resolvedAccountId),
              inArray(importPendingPayment.externalId, externalIds),
            ),
          );
      }
    }

    // Se OFX period disponível, garante a invoice única do statement.
    let ofxInvoiceId: string | null = null;
    let ofxInvoicePeriodEnd: string | null = null;
    if (useOfxPeriod && accountClosingDay && accountDueDay) {
      const periodStartIso = ofxPeriodStart!;
      const periodEndIso = ofxPeriodEnd!;
      const dueDate = deriveDueDate(
        periodEndIso,
        accountClosingDay,
        accountDueDay,
      );

      // Tenta achar invoice já existente (por exact periodEnd, ou por overlap
      // significativo — caso a fatura tenha sido criada antes com período errado).
      const [exact] = await tx
        .select()
        .from(creditCardInvoice)
        .where(
          and(
            eq(creditCardInvoice.organizationId, orgId),
            eq(creditCardInvoice.accountId, resolvedAccountId),
            eq(creditCardInvoice.periodEnd, periodEndIso),
          ),
        )
        .limit(1);

      if (exact) {
        ofxInvoiceId = exact.id;
        // Se periodStart/dueDate diferem, atualiza pra refletir o OFX.
        if (
          exact.periodStart !== periodStartIso ||
          exact.dueDate !== dueDate
        ) {
          await tx
            .update(creditCardInvoice)
            .set({ periodStart: periodStartIso, dueDate })
            .where(eq(creditCardInvoice.id, exact.id));
        }
      } else {
        // Heurística estreita: só "casa" com fatura existente cujo periodEnd
        // está a ±3 dias do periodEnd do OFX (cobre bug de boundary +/-1
        // dia em imports antigos sem grudar em fatura adjacente).
        const lowerEnd = shiftDate(periodEndIso, -3);
        const upperEnd = shiftDate(periodEndIso, 3);
        const close = await tx
          .select()
          .from(creditCardInvoice)
          .where(
            and(
              eq(creditCardInvoice.organizationId, orgId),
              eq(creditCardInvoice.accountId, resolvedAccountId),
              sql`${creditCardInvoice.periodEnd} BETWEEN ${lowerEnd} AND ${upperEnd}`,
            ),
          );
        if (close.length === 1) {
          ofxInvoiceId = close[0].id;
          await tx
            .update(creditCardInvoice)
            .set({
              periodStart: periodStartIso,
              periodEnd: periodEndIso,
              dueDate,
            })
            .where(eq(creditCardInvoice.id, close[0].id));
        } else {
          const [created] = await tx
            .insert(creditCardInvoice)
            .values({
              organizationId: orgId,
              accountId: resolvedAccountId,
              periodStart: periodStartIso,
              periodEnd: periodEndIso,
              dueDate,
              totalAmount: "0",
            })
            .returning({ id: creditCardInvoice.id });
          ofxInvoiceId = created.id;
        }
      }
      ofxInvoicePeriodEnd = periodEndIso;
      if (ofxInvoiceId) touchedInvoiceIds.add(ofxInvoiceId);
    }

    const [is] = await tx
      .insert(importSession)
      .values({
        organizationId: orgId,
        accountId: resolvedAccountId,
        source: baseParsed.data.source,
        filename: baseParsed.data.filename || null,
        periodStart: baseParsed.data.periodStart || null,
        periodEnd: baseParsed.data.periodEnd || null,
        importedCount: 0,
        duplicateCount: 0,
        accountCreated,
        createdById: userId,
      })
      .returning({ id: importSession.id });
    importSessionId = is.id;

    for (const t of txs) {
      if (t.externalId && existingExternal.has(t.externalId)) {
        duplicates++;
        continue;
      }

      // Credit card: payment received → match with paid invoice OR payment transaction
      if (
        accountKind === "credit_card" &&
        t.isPaymentReceived &&
        t.externalId
      ) {
        const invoiceCandidates = await tx
          .select({ id: creditCardInvoice.id })
          .from(creditCardInvoice)
          .where(
            and(
              eq(creditCardInvoice.organizationId, orgId),
              eq(creditCardInvoice.accountId, resolvedAccountId),
              eq(creditCardInvoice.status, "paid"),
              eq(creditCardInvoice.totalAmount, t.amount),
              isNull(creditCardInvoice.externalPaymentId),
            ),
          );

        const txCandidates = await tx
          .select({ id: transaction.id })
          .from(transaction)
          .where(
            and(
              eq(transaction.organizationId, orgId),
              eq(transaction.kind, "expense"),
              eq(transaction.amount, t.amount),
              isNull(transaction.externalPaymentId),
              sql`${transaction.paymentMethod} IN ('card_prepay', 'card_invoice_payment', 'fatura_cartao')`,
            ),
          );

        const totalCandidates = invoiceCandidates.length + txCandidates.length;

        if (totalCandidates === 1) {
          if (invoiceCandidates.length === 1) {
            await tx
              .update(creditCardInvoice)
              .set({ externalPaymentId: t.externalId })
              .where(eq(creditCardInvoice.id, invoiceCandidates[0].id));
          } else {
            await tx
              .update(transaction)
              .set({ externalPaymentId: t.externalId })
              .where(eq(transaction.id, txCandidates[0].id));
          }
          paymentsLinked++;
        } else {
          // 0 or 2+ matches → pending for manual resolution
          const [existingPending] = await tx
            .select({ id: importPendingPayment.id })
            .from(importPendingPayment)
            .where(
              and(
                eq(importPendingPayment.organizationId, orgId),
                eq(importPendingPayment.accountId, resolvedAccountId),
                eq(importPendingPayment.externalId, t.externalId),
              ),
            )
            .limit(1);
          if (!existingPending) {
            await tx.insert(importPendingPayment).values({
              organizationId: orgId,
              accountId: resolvedAccountId,
              externalId: t.externalId,
              amount: t.amount,
              occurredOn: t.occurredOn,
              rawDescription: t.description,
              source: baseParsed.data.source,
              importSessionId,
            });
            paymentsPending++;
          }
        }
        continue; // never insert as transaction
      }

      // Credit card: regular transaction → allocate to invoice
      let creditCardInvoiceId: string | null = null;
      let invoicePeriodEnd: string | null = null;
      if (accountKind === "credit_card") {
        if (
          ofxInvoiceId &&
          ofxInvoicePeriodEnd &&
          ofxPeriodStart &&
          t.occurredOn >= ofxPeriodStart &&
          t.occurredOn <= ofxInvoicePeriodEnd
        ) {
          // Está dentro do período do OFX → vai pra invoice única do statement
          creditCardInvoiceId = ofxInvoiceId;
          invoicePeriodEnd = ofxInvoicePeriodEnd;
        } else {
          // Fallback: calcula por closingDay (manual flow ou OFX sem período)
          const period = periodForDate(
            t.occurredOn,
            accountClosingDay!,
            accountDueDay!,
          );
          const [existing] = await tx
            .select()
            .from(creditCardInvoice)
            .where(
              and(
                eq(creditCardInvoice.organizationId, orgId),
                eq(creditCardInvoice.accountId, resolvedAccountId),
                eq(creditCardInvoice.periodEnd, period.periodEnd),
              ),
            )
            .limit(1);
          if (existing) {
            creditCardInvoiceId = existing.id;
          } else {
            const [created] = await tx
              .insert(creditCardInvoice)
              .values({
                organizationId: orgId,
                accountId: resolvedAccountId,
                periodStart: period.periodStart,
                periodEnd: period.periodEnd,
                dueDate: period.dueDate,
                totalAmount: "0",
              })
              .returning({ id: creditCardInvoice.id });
            creditCardInvoiceId = created.id;
          }
          invoicePeriodEnd = period.periodEnd;
          touchedInvoiceIds.add(creditCardInvoiceId);
        }
      }

      const parsedDesc = parseDescription(t.description);
      const suggestedCategoryId = await getAutoApplyCategoryId(
        orgId,
        t.kind,
        t.description,
        parsedDesc.cleanDescription,
      );

      // Para cartão: occurredOn = period_end da fatura (pra agrupar certo
      // na visualização "por fatura"). purchaseDate = data real da compra.
      // Para conta bancária: occurredOn = data do extrato.
      const insertOccurredOn =
        accountKind === "credit_card" && invoicePeriodEnd
          ? invoicePeriodEnd
          : t.occurredOn;

      await tx.insert(transaction).values({
        organizationId: orgId,
        accountId: resolvedAccountId,
        categoryId: suggestedCategoryId,
        kind: t.kind,
        amount: t.amount,
        description: t.description,
        occurredOn: insertOccurredOn,
        purchaseDate: t.occurredOn,
        externalId: t.externalId,
        importSessionId,
        creditCardInvoiceId,
        installmentNumber: t.installmentNumber ?? null,
        installmentTotal: t.installmentTotal ?? null,
        cleanDescription: parsedDesc.cleanDescription,
        paymentMethod: parsedDesc.paymentMethod,
        counterpartyName: parsedDesc.counterpartyName,
        counterpartyDocument: parsedDesc.counterpartyDocument,
        counterpartyBank: parsedDesc.counterpartyBank,
        counterpartyBranch: parsedDesc.counterpartyBranch,
        counterpartyAccount: parsedDesc.counterpartyAccount,
        createdById: userId,
        ownerId: resolvedOwnerId,
      });
      imported++;

      if (creditCardInvoiceId) touchedInvoiceIds.add(creditCardInvoiceId);
    }

    // Recalcula total das faturas afetadas a partir do que está realmente
    // gravado em transaction (autoritativo, suporta reimport onde apagamos
    // linhas antes de inserir).
    for (const invId of touchedInvoiceIds) {
      const [r] = await tx
        .select({
          total: sql<string>`COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount ELSE -amount END)::numeric, 0)`,
        })
        .from(transaction)
        .where(
          and(
            eq(transaction.organizationId, orgId),
            eq(transaction.creditCardInvoiceId, invId),
          ),
        );
      await tx
        .update(creditCardInvoice)
        .set({ totalAmount: Number(r?.total ?? 0).toFixed(2) })
        .where(eq(creditCardInvoice.id, invId));
    }

    await tx
      .update(importSession)
      .set({ importedCount: imported, duplicateCount: duplicates })
      .where(eq(importSession.id, importSessionId));
  });

  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  revalidatePath("/contas");
  revalidatePath("/cartoes");
  revalidatePath("/importar");

  return {
    success: {
      accountId: resolvedAccountId,
      importSessionId,
      imported,
      duplicates,
      reimported,
      paymentsLinked,
      paymentsPending,
      accountCreated,
    },
  };
}

export async function reparseDescriptionsAction(): Promise<{
  updated: number;
  skipped: number;
}> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  const rows = await db
    .select({
      id: transaction.id,
      description: transaction.description,
    })
    .from(transaction)
    .where(eq(transaction.organizationId, orgId));

  let updated = 0;
  let skipped = 0;
  for (const r of rows) {
    if (!r.description) {
      skipped++;
      continue;
    }
    const parsed = parseDescription(r.description);
    await db
      .update(transaction)
      .set({
        cleanDescription: parsed.cleanDescription,
        paymentMethod: parsed.paymentMethod,
        counterpartyName: parsed.counterpartyName,
        counterpartyDocument: parsed.counterpartyDocument,
        counterpartyBank: parsed.counterpartyBank,
        counterpartyBranch: parsed.counterpartyBranch,
        counterpartyAccount: parsed.counterpartyAccount,
      })
      .where(eq(transaction.id, r.id));
    updated++;
  }

  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  return { updated, skipped };
}
