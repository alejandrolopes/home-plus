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
import {
  deriveDueDate,
  derivePeriodFromDueDate,
  periodForDate,
} from "@/lib/credit-card";
import { parseDescription } from "@/lib/import/description-parser";
import {
  getAutoApplyCategoryId,
  suggestCategoryForTransaction,
  type Suggestion,
} from "@/lib/repos/category-suggestions";
import { recomputeInvoice } from "@/lib/repos/invoices";
import {
  detectRefundCandidates,
  type RefundCandidate,
} from "@/lib/repos/refund-detection";
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
  /**
   * Chave estável definida pelo cliente (geralmente externalId ou idx-N),
   * usada pra casar overrides de categoria e vínculos de estorno.
   */
  key: z.string().min(1).max(200).optional(),
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
   * JSON array paralelo a `transactions`: cada posição contém o categoryId
   * escolhido pelo usuário (uuid) ou "" pra "sem categoria". Quando ausente,
   * a action cai no fallback de auto-aplicação por histórico.
   */
  categoryOverrides: z.string().optional().or(z.literal("")),
  /**
   * JSON array de vínculos de estorno confirmados pelo usuário. Cada item:
   *   { refundKey: string; originalKey?: string; originalTransactionId?: string }
   * `refundKey` e `originalKey` referem-se a posições no array `transactions`
   * via a chave estável definida pelo cliente (mesma usada em categoryOverrides).
   */
  refundLinks: z.string().optional().or(z.literal("")),
  /**
   * Quando "on", apaga transações existentes desta conta cujos externalIds
   * estão neste arquivo, e refaz o cálculo da fatura/período. Usar pra
   * corrigir imports antigos que ficaram com período/fatura erradas.
   */
  reimport: z.string().optional().or(z.literal("")),
  /**
   * JSON array de vínculos automáticos confirmados pelo usuário. Cada item:
   *   { paymentKey: string; linkTo: "invoice:uuid" | "transaction:uuid" | null }
   * `paymentKey` casa com a `key` estável da transação no array `transactions`.
   * `linkTo=null` significa "vai pra pendência mesmo havendo candidato".
   * Quando o campo é omitido, o servidor cai no auto-detect legado.
   */
  autoLinks: z.string().optional().or(z.literal("")),
  /**
   * Para cartão: força TODOS os lançamentos do arquivo a entrarem nesta
   * fatura, ignorando o cálculo por data. Se vazio, usa newInvoice* ou cai
   * no fluxo automático (período do OFX → invoice, ou periodForDate).
   */
  targetInvoiceId: z.string().uuid().optional().or(z.literal("")),
  /**
   * Quando preenchido em conjunto, cria uma nova fatura com estes campos e
   * força todos os lançamentos pra ela. Ignorado se targetInvoiceId vier.
   */
  newInvoicePeriodStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  newInvoicePeriodEnd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  newInvoiceDueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
});

const overrideSchema = z.array(
  z.union([z.string().uuid(), z.literal("")]),
);

const refundLinkSchema = z.array(
  z.object({
    refundKey: z.string().min(1).max(200),
    originalKey: z.string().min(1).max(200).optional(),
    originalTransactionId: z.string().uuid().optional(),
  }),
);

const autoLinkSchema = z.array(
  z.object({
    paymentKey: z.string().min(1).max(200),
    linkTo: z
      .string()
      .regex(/^(invoice|transaction):[0-9a-f-]{36}$/)
      .nullable(),
  }),
);

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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
    refundsLinked: number;
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

  let overrides: Array<string | null> | null = null;
  const rawOverrides = baseParsed.data.categoryOverrides;
  if (rawOverrides) {
    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(rawOverrides);
    } catch {
      return { error: "Categorias selecionadas inválidas." };
    }
    const result = overrideSchema.safeParse(parsedRaw);
    if (!result.success || result.data.length !== txs.length) {
      return { error: "Categorias selecionadas inválidas." };
    }
    overrides = result.data.map((v) => (v === "" ? null : v));
  }

  let refundLinks: z.infer<typeof refundLinkSchema> = [];
  const rawRefundLinks = baseParsed.data.refundLinks;
  if (rawRefundLinks) {
    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(rawRefundLinks);
    } catch {
      return { error: "Estornos selecionados inválidos." };
    }
    const result = refundLinkSchema.safeParse(parsedRaw);
    if (!result.success) {
      return { error: "Estornos selecionados inválidos." };
    }
    refundLinks = result.data;
  }

  // autoLinks: quando enviado pelo cliente (mesmo vazio), o servidor honra a
  // decisão do usuário em vez de re-rodar o auto-detect. Mapa paymentKey →
  // "invoice:uuid" | "transaction:uuid" | null. Quando o campo é omitido,
  // mantém o comportamento legado (auto-link silencioso).
  let autoLinkMap: Map<string, string | null> | null = null;
  const rawAutoLinks = baseParsed.data.autoLinks;
  if (rawAutoLinks) {
    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(rawAutoLinks);
    } catch {
      return { error: "Vínculos automáticos inválidos." };
    }
    const result = autoLinkSchema.safeParse(parsedRaw);
    if (!result.success) {
      return { error: "Vínculos automáticos inválidos." };
    }
    autoLinkMap = new Map();
    for (const a of result.data) autoLinkMap.set(a.paymentKey, a.linkTo);
  }

  // Mapeia key -> idx no array de txs (necessário pra resolver vínculos depois)
  const keyToIdx = new Map<string, number>();
  for (let i = 0; i < txs.length; i++) {
    const k = txs[i].key;
    if (k) keyToIdx.set(k, i);
  }

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
  // Chave de dedup combina external_id + installment_number + kind. Nubank
  // reusa o mesmo FITID em:
  //   (a) todas as parcelas de uma compra (só muda installment_number)
  //   (b) o estorno e a compra original (mesmo FITID, mas kind oposto)
  // Sem os 3 componentes, parcelas 2..N e/ou estornos viram falsos duplicados.
  function dedupKey(
    externalId: string | null | undefined,
    installmentNumber: number | null | undefined,
    kind: string | null | undefined,
  ): string | null {
    if (!externalId) return null;
    return `${externalId}|${installmentNumber ?? ""}|${kind ?? ""}`;
  }
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
      .select({
        externalId: transaction.externalId,
        installmentNumber: transaction.installmentNumber,
        kind: transaction.kind,
      })
      .from(transaction)
      .where(
        and(
          eq(transaction.organizationId, orgId),
          eq(transaction.accountId, resolvedAccountId),
          inArray(transaction.externalId, externalIds),
        ),
      );
    for (const r of rows) {
      const k = dedupKey(r.externalId, r.installmentNumber, r.kind);
      if (k) existingExternal.add(k);
    }
  }

  let imported = 0;
  let duplicates = 0;
  let reimported = 0;
  let paymentsLinked = 0;
  let paymentsPending = 0;
  let refundsLinked = 0;
  let importSessionId = "";
  // Faturas afetadas (precisam recalcular total ao final)
  const touchedInvoiceIds = new Set<string>();
  // idx em `txs` → id gerado, usado para resolver vínculos de estorno
  const insertedIdByIdx = new Map<number, string>();

  // Override manual de fatura: existe ou novo. Quando preenchido, força TODOS
  // os lançamentos do arquivo a entrarem nessa fatura, ignorando o cálculo
  // por data (periodForDate / range do período do OFX).
  const targetInvoiceId = baseParsed.data.targetInvoiceId || "";
  let newInvoicePeriodStart = baseParsed.data.newInvoicePeriodStart || "";
  let newInvoicePeriodEnd = baseParsed.data.newInvoicePeriodEnd || "";
  const newInvoiceDueDate = baseParsed.data.newInvoiceDueDate || "";
  // Nova fatura: dueDate é o único campo obrigatório; periodStart/periodEnd
  // são derivados de dueDate + closingDay/dueDay do cartão quando ausentes.
  const hasNewInvoice = !!newInvoiceDueDate;
  if (accountKind === "credit_card") {
    if (targetInvoiceId && hasNewInvoice) {
      return {
        error: "Escolha uma fatura existente OU crie nova, não ambos.",
      };
    }
    if (hasNewInvoice) {
      // Deriva períodos quando vazios. Requer closingDay/dueDay configurados
      // (já validado acima pra cartão).
      if (!newInvoicePeriodStart || !newInvoicePeriodEnd) {
        if (!accountClosingDay || !accountDueDay) {
          return {
            error:
              "Cartão sem closingDay/dueDay configurado — preencha o período manualmente.",
          };
        }
        const derived = derivePeriodFromDueDate(
          newInvoiceDueDate,
          accountClosingDay,
          accountDueDay,
        );
        if (!newInvoicePeriodStart) newInvoicePeriodStart = derived.periodStart;
        if (!newInvoicePeriodEnd) newInvoicePeriodEnd = derived.periodEnd;
      }
      if (newInvoicePeriodStart >= newInvoicePeriodEnd) {
        return {
          error: "Início da nova fatura deve ser anterior ao fim.",
        };
      }
    }
  } else if (targetInvoiceId || hasNewInvoice) {
    return {
      error:
        "Seleção de fatura só se aplica a cartão de crédito.",
    };
  }

  await db.transaction(async (tx) => {
    // Se reimport mode, apaga transações que casam com (external_id,
    // installment_number) das linhas DESTE arquivo. Usar só external_id
    // apagaria parcelas de outras faturas (Nubank reutiliza FITID entre
    // parcelas de uma mesma compra).
    if (reimportMode && externalIds.length > 0) {
      const fileDedupKeys = new Set<string>();
      for (const t of txs) {
        const k = dedupKey(t.externalId, t.installmentNumber ?? null, t.kind);
        if (k) fileDedupKeys.add(k);
      }
      const candidates = await tx
        .select({
          id: transaction.id,
          externalId: transaction.externalId,
          installmentNumber: transaction.installmentNumber,
          kind: transaction.kind,
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
      const toDeleteIds: string[] = [];
      for (const r of candidates) {
        const k = dedupKey(r.externalId, r.installmentNumber, r.kind);
        if (k && fileDedupKeys.has(k)) {
          toDeleteIds.push(r.id);
          if (r.invoiceId) touchedInvoiceIds.add(r.invoiceId);
        }
      }
      if (toDeleteIds.length > 0) {
        await tx
          .delete(transaction)
          .where(inArray(transaction.id, toDeleteIds));
        reimported = toDeleteIds.length;
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
    // Quando true, TODOS os lançamentos do cartão vão para `ofxInvoiceId`,
    // independente da data — usado quando o usuário escolhe explicitamente
    // a fatura alvo no fluxo de import.
    let forceAllToInvoice = false;

    if (accountKind === "credit_card" && targetInvoiceId) {
      const [inv] = await tx
        .select()
        .from(creditCardInvoice)
        .where(
          and(
            eq(creditCardInvoice.id, targetInvoiceId),
            eq(creditCardInvoice.organizationId, orgId),
            eq(creditCardInvoice.accountId, resolvedAccountId),
          ),
        )
        .limit(1);
      if (!inv) {
        throw new Error("Fatura selecionada não pertence a este cartão.");
      }
      ofxInvoiceId = inv.id;
      ofxInvoicePeriodEnd = inv.periodEnd;
      forceAllToInvoice = true;
      touchedInvoiceIds.add(inv.id);
    } else if (accountKind === "credit_card" && hasNewInvoice) {
      const [created] = await tx
        .insert(creditCardInvoice)
        .values({
          organizationId: orgId,
          accountId: resolvedAccountId,
          periodStart: newInvoicePeriodStart,
          periodEnd: newInvoicePeriodEnd,
          dueDate: newInvoiceDueDate,
          totalAmount: "0",
        })
        .returning({ id: creditCardInvoice.id });
      ofxInvoiceId = created.id;
      ofxInvoicePeriodEnd = newInvoicePeriodEnd;
      forceAllToInvoice = true;
      touchedInvoiceIds.add(created.id);
    } else if (useOfxPeriod && accountClosingDay && accountDueDay) {
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

    for (let txIdx = 0; txIdx < txs.length; txIdx++) {
      const t = txs[txIdx];
      const dk = dedupKey(t.externalId, t.installmentNumber ?? null, t.kind);
      if (dk && existingExternal.has(dk)) {
        duplicates++;
        continue;
      }

      // Credit card: payment received → match with paid invoice OR payment transaction
      if (
        accountKind === "credit_card" &&
        t.isPaymentReceived &&
        t.externalId
      ) {
        // Decide o destino do vínculo. Se o cliente mandou `autoLinks`, o
        // usuário é a autoridade: aplica exatamente o que ele confirmou,
        // sem rodar o auto-detect aqui. Caso o cliente NÃO tenha enviado
        // o campo (sem UI de revisão), volta no caminho legado.
        let resolvedInvoiceId: string | null = null;
        let resolvedTxId: string | null = null;

        if (autoLinkMap !== null && t.key && autoLinkMap.has(t.key)) {
          const linkTo = autoLinkMap.get(t.key) ?? null;
          if (linkTo) {
            const [kind, id] = linkTo.split(":") as [
              "invoice" | "transaction",
              string,
            ];
            if (kind === "invoice") resolvedInvoiceId = id;
            else resolvedTxId = id;
          }
          // linkTo===null: usuário desmarcou explicitamente → pending
        } else if (autoLinkMap === null) {
          // Legacy: re-roda detect aqui
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

          if (invoiceCandidates.length + txCandidates.length === 1) {
            if (invoiceCandidates.length === 1)
              resolvedInvoiceId = invoiceCandidates[0].id;
            else resolvedTxId = txCandidates[0].id;
          }
        }

        if (resolvedInvoiceId || resolvedTxId) {
          if (resolvedInvoiceId) {
            await tx
              .update(creditCardInvoice)
              .set({ externalPaymentId: t.externalId })
              .where(eq(creditCardInvoice.id, resolvedInvoiceId));
          } else if (resolvedTxId) {
            // Match com lançamento de pagamento já existente: marca o vínculo
            // (paid_invoice_id) na fatura ALVO desta importação (a fatura
            // sendo importada agora, escolhida pelo usuário). Sem heurística
            // de "encaixa em qualquer aberta" — recompute deriva o resto.
            // Se não houver fatura alvo identificável, só marca link fraco.
            const txId = resolvedTxId;
            const now = new Date();
            if (ofxInvoiceId) {
              await tx
                .update(transaction)
                .set({
                  externalPaymentId: t.externalId,
                  paidInvoiceId: ofxInvoiceId,
                  paymentMethod: "card_prepay",
                  updatedAt: now,
                })
                .where(eq(transaction.id, txId));
              touchedInvoiceIds.add(ofxInvoiceId);
            } else {
              await tx
                .update(transaction)
                .set({
                  externalPaymentId: t.externalId,
                  paymentMethod: "card_prepay",
                  updatedAt: now,
                })
                .where(eq(transaction.id, txId));
            }
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
        if (forceAllToInvoice && ofxInvoiceId && ofxInvoicePeriodEnd) {
          // Usuário escolheu/criou a fatura alvo → força todo o arquivo
          creditCardInvoiceId = ofxInvoiceId;
          invoicePeriodEnd = ofxInvoicePeriodEnd;
        } else if (
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
      let resolvedCategoryId: string | null;
      if (overrides !== null) {
        // UI confirmou explicitamente (uuid ou null pra "sem categoria")
        resolvedCategoryId = overrides[txIdx];
      } else {
        // Compat: sem overrides → mantém comportamento legado de auto-apply
        resolvedCategoryId = await getAutoApplyCategoryId(
          orgId,
          t.kind,
          t.description,
          parsedDesc.cleanDescription,
        );
      }

      // Para cartão: occurredOn = period_end da fatura (pra agrupar certo
      // na visualização "por fatura"). purchaseDate = data real da compra.
      // Para conta bancária: occurredOn = data do extrato.
      const insertOccurredOn =
        accountKind === "credit_card" && invoicePeriodEnd
          ? invoicePeriodEnd
          : t.occurredOn;

      const [insertedRow] = await tx.insert(transaction).values({
        organizationId: orgId,
        accountId: resolvedAccountId,
        categoryId: resolvedCategoryId,
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
      }).returning({ id: transaction.id });
      imported++;
      insertedIdByIdx.set(txIdx, insertedRow.id);

      if (creditCardInvoiceId) touchedInvoiceIds.add(creditCardInvoiceId);
    }

    // === Aplica vínculos de estorno ===
    if (refundLinks.length > 0) {
      // Validação: ids antigos referenciados devem existir e pertencer à
      // mesma org + conta, para evitar vínculos cruzados maliciosos.
      const requestedDbIds = Array.from(
        new Set(
          refundLinks
            .map((l) => l.originalTransactionId)
            .filter((v): v is string => !!v),
        ),
      );
      const validDbIds = new Set<string>();
      if (requestedDbIds.length > 0) {
        const rows = await tx
          .select({ id: transaction.id })
          .from(transaction)
          .where(
            and(
              eq(transaction.organizationId, orgId),
              eq(transaction.accountId, resolvedAccountId),
              inArray(transaction.id, requestedDbIds),
            ),
          );
        for (const r of rows) validDbIds.add(r.id);
      }

      for (const link of refundLinks) {
        const refundIdx = keyToIdx.get(link.refundKey);
        if (refundIdx == null) continue;
        const refundId = insertedIdByIdx.get(refundIdx);
        if (!refundId) continue;

        let originalId: string | null = null;
        if (link.originalKey) {
          const origIdx = keyToIdx.get(link.originalKey);
          if (origIdx != null) {
            originalId = insertedIdByIdx.get(origIdx) ?? null;
          }
        }
        if (!originalId && link.originalTransactionId) {
          if (validDbIds.has(link.originalTransactionId)) {
            originalId = link.originalTransactionId;
          }
        }
        if (!originalId || originalId === refundId) continue;

        await tx
          .update(transaction)
          .set({
            reversesTransactionId: originalId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(transaction.id, refundId),
              eq(transaction.organizationId, orgId),
            ),
          );
        refundsLinked++;
      }
    }

    // Recalcula todas as faturas afetadas pelo único caminho oficial:
    // recomputeInvoice lê transactions e deriva totalAmount/paidAmount/status.
    for (const invId of touchedInvoiceIds) {
      await recomputeInvoice(tx, invId);
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
      refundsLinked,
      accountCreated,
    },
  };
}

export type BatchSuggestionResult = {
  key: string;
  suggestion: Suggestion | null;
};

/**
 * Calcula sugestões de categoria em lote para a UI da importação.
 * Recebe items com uma chave estável (definida pelo cliente) + kind+descrição,
 * e devolve a sugestão para cada um. Dedupa internamente por (kind, descrição
 * normalizada) pra evitar N queries quando o extrato tem repetições.
 */
export async function suggestCategoriesBatchAction(
  items: Array<{
    key: string;
    kind: "income" | "expense";
    description: string;
  }>,
): Promise<BatchSuggestionResult[]> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  if (items.length === 0) return [];

  type Enriched = {
    key: string;
    kind: "income" | "expense";
    description: string;
    cleanDescription: string;
    dedupeKey: string;
  };
  const enriched: Enriched[] = items.map((it) => {
    const clean = parseDescription(it.description).cleanDescription;
    const base = (clean || it.description).toLowerCase();
    return {
      key: it.key,
      kind: it.kind,
      description: it.description,
      cleanDescription: clean,
      dedupeKey: `${it.kind}:${base}`,
    };
  });

  const unique = new Map<string, Enriched>();
  for (const e of enriched) {
    if (!unique.has(e.dedupeKey)) unique.set(e.dedupeKey, e);
  }

  const suggestionByDedupe = new Map<string, Suggestion | null>();
  await Promise.all(
    Array.from(unique.values()).map(async (e) => {
      const s = await suggestCategoryForTransaction(
        orgId,
        e.kind,
        e.description,
        e.cleanDescription,
      );
      suggestionByDedupe.set(e.dedupeKey, s);
    }),
  );

  return enriched.map((e) => ({
    key: e.key,
    suggestion: suggestionByDedupe.get(e.dedupeKey) ?? null,
  }));
}

/**
 * Detecta candidatos de estorno entre as transações que estão sendo importadas
 * e (a) outras transações do mesmo lote e (b) transações já gravadas para a
 * conta selecionada. Retorna lista vazia se não há conta resolvida ainda.
 */
export async function detectRefundCandidatesAction(params: {
  /** Vazio quando ainda em modo "nova conta" — só detecta pares intra-lote. */
  accountId: string;
  items: Array<{
    key: string;
    kind: "income" | "expense";
    amount: string;
    description: string;
    occurredOn: string;
  }>;
}): Promise<RefundCandidate[]> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  if (params.items.length === 0) return [];

  const enriched = params.items.map((it) => {
    const parsed = parseDescription(it.description);
    return {
      key: it.key,
      kind: it.kind,
      amount: it.amount,
      description: it.description,
      cleanDescription: parsed.cleanDescription,
      counterpartyName: parsed.counterpartyName,
      occurredOn: it.occurredOn,
    };
  });

  return detectRefundCandidates({
    orgId,
    accountId: params.accountId,
    newTransactions: enriched,
  });
}

export type AutoLinkCandidate =
  | {
      kind: "invoice";
      id: string;
      label: string;
      periodEnd: string;
      dueDate: string;
      totalAmount: string;
    }
  | {
      kind: "transaction";
      id: string;
      label: string;
      description: string;
      occurredOn: string;
      amount: string;
    };

export type DetectedAutoLink = {
  paymentKey: string;
  paymentAmount: string;
  paymentDescription: string;
  paymentOccurredOn: string;
  candidate: AutoLinkCandidate;
};

/**
 * Detecta vínculos automáticos para "Pagamento recebido" do extrato de cartão:
 * cada pagamento que tiver EXATAMENTE 1 candidato (fatura paga de mesmo valor
 * sem link, OU transação de pagamento já existente sem link) entra como
 * proposta. 0 ou 2+ candidatos viram pendência automática e não precisam de
 * confirmação. Mesma lógica do bloco interno do `confirmImportAction`.
 */
export async function detectAutoLinksAction(params: {
  accountId: string;
  items: Array<{
    key: string;
    externalId: string | null;
    amount: string;
    description: string;
    occurredOn: string;
    isPaymentReceived: boolean;
  }>;
}): Promise<DetectedAutoLink[]> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  if (!params.accountId || params.items.length === 0) return [];
  const accountUuid = z.string().uuid().safeParse(params.accountId);
  if (!accountUuid.success) return [];

  const [acc] = await db
    .select({ id: financialAccount.id, type: financialAccount.type })
    .from(financialAccount)
    .where(
      and(
        eq(financialAccount.id, accountUuid.data),
        eq(financialAccount.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!acc || acc.type !== "credit_card") return [];

  const payments = params.items.filter(
    (t) => t.isPaymentReceived && t.externalId,
  );
  if (payments.length === 0) return [];

  const results: DetectedAutoLink[] = [];
  for (const p of payments) {
    const invoiceCandidates = await db
      .select({
        id: creditCardInvoice.id,
        periodEnd: creditCardInvoice.periodEnd,
        dueDate: creditCardInvoice.dueDate,
        totalAmount: creditCardInvoice.totalAmount,
      })
      .from(creditCardInvoice)
      .where(
        and(
          eq(creditCardInvoice.organizationId, orgId),
          eq(creditCardInvoice.accountId, accountUuid.data),
          eq(creditCardInvoice.status, "paid"),
          eq(creditCardInvoice.totalAmount, p.amount),
          isNull(creditCardInvoice.externalPaymentId),
        ),
      );

    const txCandidates = await db
      .select({
        id: transaction.id,
        description: transaction.description,
        occurredOn: transaction.occurredOn,
        amount: transaction.amount,
      })
      .from(transaction)
      .where(
        and(
          eq(transaction.organizationId, orgId),
          eq(transaction.kind, "expense"),
          eq(transaction.amount, p.amount),
          isNull(transaction.externalPaymentId),
          sql`${transaction.paymentMethod} IN ('card_prepay', 'card_invoice_payment', 'fatura_cartao')`,
        ),
      );

    const total = invoiceCandidates.length + txCandidates.length;
    if (total !== 1) continue; // 0 ou 2+ vai pra pendência sem precisar confirmar

    let candidate: AutoLinkCandidate;
    if (invoiceCandidates.length === 1) {
      const inv = invoiceCandidates[0];
      candidate = {
        kind: "invoice",
        id: inv.id,
        label: `Fatura venc ${inv.dueDate} — R$ ${inv.totalAmount}`,
        periodEnd: inv.periodEnd,
        dueDate: inv.dueDate,
        totalAmount: inv.totalAmount,
      };
    } else {
      const t = txCandidates[0];
      candidate = {
        kind: "transaction",
        id: t.id,
        label: `Lançamento ${t.occurredOn} — R$ ${t.amount} — ${t.description.slice(0, 60)}`,
        description: t.description,
        occurredOn: t.occurredOn,
        amount: t.amount,
      };
    }

    results.push({
      paymentKey: p.key,
      paymentAmount: p.amount,
      paymentDescription: p.description,
      paymentOccurredOn: p.occurredOn,
      candidate,
    });
  }

  return results;
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

export type ImportInvoiceOption = {
  id: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  totalAmount: string;
  status: "open" | "closed" | "paid";
};

export async function listInvoicesForImportAction(
  accountId: string,
): Promise<ImportInvoiceOption[]> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  if (!accountId) return [];
  const accountUuid = z.string().uuid().safeParse(accountId);
  if (!accountUuid.success) return [];

  const [acc] = await db
    .select({ id: financialAccount.id, type: financialAccount.type })
    .from(financialAccount)
    .where(
      and(
        eq(financialAccount.id, accountUuid.data),
        eq(financialAccount.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!acc || acc.type !== "credit_card") return [];

  const rows = await db
    .select({
      id: creditCardInvoice.id,
      periodStart: creditCardInvoice.periodStart,
      periodEnd: creditCardInvoice.periodEnd,
      dueDate: creditCardInvoice.dueDate,
      totalAmount: creditCardInvoice.totalAmount,
      status: creditCardInvoice.status,
    })
    .from(creditCardInvoice)
    .where(
      and(
        eq(creditCardInvoice.organizationId, orgId),
        eq(creditCardInvoice.accountId, accountUuid.data),
      ),
    )
    .orderBy(sql`${creditCardInvoice.periodEnd} DESC`);

  return rows.map((r) => ({
    id: r.id,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    dueDate: r.dueDate,
    totalAmount: r.totalAmount,
    status: r.status,
  }));
}
