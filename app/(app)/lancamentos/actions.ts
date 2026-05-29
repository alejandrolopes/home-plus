"use server";

import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  category,
  creditCardInvoice,
  financialAccount,
  transaction,
} from "@/db/schema/finance";
import { divideAmount, periodForDate } from "@/lib/credit-card";
import { getAutoApplyCategoryId } from "@/lib/repos/category-suggestions";
import { recomputeInvoice } from "@/lib/repos/invoices";
import {
  findSimilarUncategorizedTransactions,
  type SimilarLookup,
} from "@/lib/repos/similar-transactions";
import { requireOrganization } from "@/lib/guards";
import {
  PermissionDeniedError,
  canEdit,
  getMemberRole,
  isAdmin,
} from "@/lib/auth-permissions";

const TRANSFER_MATCH_WINDOW_DAYS = 7;

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Procura um lançamento que pode ser a "perna espelho" de uma transferência:
 * mesmo valor, kind oposto, na conta destino, dentro de janela de ±7 dias,
 * ainda não vinculado a outra transferência ou cartão. Retorna o mais próximo
 * em data; null se nenhum.
 */
type DbExecutor = Pick<typeof db, "select">;

async function findTransferMirror(
  tx: DbExecutor,
  orgId: string,
  params: {
    accountId: string;
    kind: "income" | "expense";
    amount: string;
    occurredOn: string;
    excludeTxId?: string;
  },
): Promise<{ id: string; ownerId: string; occurredOn: string } | null> {
  const fromIso = shiftDate(params.occurredOn, -TRANSFER_MATCH_WINDOW_DAYS);
  const toIso = shiftDate(params.occurredOn, TRANSFER_MATCH_WINDOW_DAYS);

  const where = [
    eq(transaction.organizationId, orgId),
    eq(transaction.accountId, params.accountId),
    eq(transaction.kind, params.kind),
    eq(transaction.amount, params.amount),
    isNull(transaction.transferToAccountId),
    isNull(transaction.externalPaymentId),
    isNull(transaction.parentTransactionId),
    isNull(transaction.creditCardInvoiceId),
    isNull(transaction.paidInvoiceId),
    gte(transaction.occurredOn, fromIso),
    lte(transaction.occurredOn, toIso),
  ];
  if (params.excludeTxId) {
    where.push(ne(transaction.id, params.excludeTxId));
  }

  const rows = await tx
    .select({
      id: transaction.id,
      ownerId: transaction.ownerId,
      occurredOn: transaction.occurredOn,
    })
    .from(transaction)
    .where(and(...where));

  if (rows.length === 0) return null;
  // Mais próximo em data
  rows.sort((a, b) => {
    const da = Math.abs(
      new Date(`${a.occurredOn}T00:00:00`).getTime() -
        new Date(`${params.occurredOn}T00:00:00`).getTime(),
    );
    const db = Math.abs(
      new Date(`${b.occurredOn}T00:00:00`).getTime() -
        new Date(`${params.occurredOn}T00:00:00`).getTime(),
    );
    return da - db;
  });
  return rows[0];
}

const createSchema = z.object({
  accountId: z.string().uuid(),
  categoryId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(""))
    .or(z.literal("none")),
  kind: z.enum(["income", "expense"]),
  amount: z
    .string()
    .regex(/^\d+([.,]\d{1,2})?$/, "Valor inválido")
    .transform((v) => v.replace(",", ".")),
  description: z.string().min(1, "Informe a descrição").max(200),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  installments: z.coerce.number().int().min(1).max(48).default(1),
  notes: z.string().max(500).optional().or(z.literal("")),
  transferToAccountId: z.string().uuid().optional().or(z.literal("")),
  isTithable: z.string().optional(),
  isReimbursable: z.string().optional(),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid().optional(),
  categoryId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(""))
    .or(z.literal("none")),
  amount: z
    .string()
    .regex(/^\d+([.,]\d{1,2})?$/, "Valor inválido")
    .transform((v) => v.replace(",", ".")),
  cleanDescription: z.string().min(1, "Informe a descrição").max(200),
  description: z.string().min(1).max(2000).optional().or(z.literal("")),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  notes: z.string().max(500).optional().or(z.literal("")),
  transferToAccountId: z.string().uuid().optional().or(z.literal("")),
  isTithable: z.string().optional(),
  isReimbursable: z.string().optional(),
});

export type TransactionFormState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
  success?: boolean;
} | null;

export async function saveTransactionAction(
  _prev: TransactionFormState,
  formData: FormData,
): Promise<TransactionFormState> {
  const isUpdate = !!formData.get("id");
  return isUpdate ? updateTransaction(formData) : createTransaction(formData);
}

async function createTransaction(
  formData: FormData,
): Promise<TransactionFormState> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? "_")] = issue.message;
    }
    return { error: "Verifique os campos.", fieldErrors };
  }

  const data = parsed.data;

  const [account] = await db
    .select()
    .from(financialAccount)
    .where(
      and(
        eq(financialAccount.id, data.accountId),
        eq(financialAccount.organizationId, orgId),
      ),
    )
    .limit(1);

  if (!account) return { error: "Conta não encontrada." };

  const role = await getMemberRole(orgId, userId);
  if (account.ownerId !== userId && !isAdmin(role)) {
    return { error: "Sem permissão para criar lançamento nesta conta." };
  }

  // Detecta categoria de transferência
  let isTransferCategory = false;
  if (data.categoryId && data.categoryId !== "none") {
    const [cat] = await db
      .select({ isTransfer: category.isTransfer })
      .from(category)
      .where(
        and(
          eq(category.id, data.categoryId),
          eq(category.organizationId, orgId),
        ),
      )
      .limit(1);
    isTransferCategory = !!cat?.isTransfer;
  }

  if (isTransferCategory) {
    if (account.type === "credit_card") {
      return {
        error: "Transferências não podem ser feitas a partir de cartão de crédito.",
      };
    }
    if (!data.transferToAccountId) {
      return { error: "Selecione a conta destino/origem da transferência." };
    }
    if (data.transferToAccountId === data.accountId) {
      return { error: "Conta destino deve ser diferente da conta origem." };
    }

    const [otherAccount] = await db
      .select()
      .from(financialAccount)
      .where(
        and(
          eq(financialAccount.id, data.transferToAccountId),
          eq(financialAccount.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!otherAccount)
      return { error: "Conta destino/origem não encontrada." };
    if (otherAccount.type === "credit_card") {
      return {
        error: "Transferências não podem destinar-se a cartão de crédito.",
      };
    }

    const linkId = `transfer:${randomUUID()}`;
    const isCrossUser = account.ownerId !== otherAccount.ownerId;

    if (isCrossUser) {
      // Transferência entre membros: criamos apenas a perna do criador.
      // O outro lado precisa aceitar (criando uma perna nova ou vinculando
      // a um lançamento existente) para fechar a transferência.
      await db.insert(transaction).values({
        organizationId: orgId,
        accountId: account.id,
        categoryId: data.categoryId as string,
        kind: data.kind,
        amount: data.amount,
        description: data.description,
        occurredOn: data.occurredOn,
        notes: data.notes || null,
        transferToAccountId: otherAccount.id,
        externalPaymentId: linkId,
        pendingStatus: "pending",
        requestedByUserId: userId,
        createdById: userId,
        ownerId: account.ownerId,
      });
    } else {
      // Same-user: comportamento atual — cria as duas pernas, podendo
      // vincular a uma perna espelho já existente.
      // Direção: kind=expense → "this" sai, "other" entra. kind=income → "this" entra, "other" sai.
      const sourceAccountId =
        data.kind === "expense" ? account.id : otherAccount.id;
      const destAccountId =
        data.kind === "expense" ? otherAccount.id : account.id;

      const sourceOwnerId =
        data.kind === "expense" ? account.ownerId : otherAccount.ownerId;
      const destOwnerId =
        data.kind === "expense" ? otherAccount.ownerId : account.ownerId;

      await db.transaction(async (tx) => {
        await tx.insert(transaction).values({
          organizationId: orgId,
          accountId: sourceAccountId,
          categoryId: data.categoryId as string,
          kind: "expense",
          amount: data.amount,
          description: data.description,
          occurredOn: data.occurredOn,
          notes: data.notes || null,
          transferToAccountId: destAccountId,
          externalPaymentId: linkId,
          createdById: userId,
          ownerId: sourceOwnerId,
        });

        const mirror = await findTransferMirror(tx, orgId, {
          accountId: destAccountId,
          kind: "income",
          amount: data.amount,
          occurredOn: data.occurredOn,
        });
        if (mirror) {
          await tx
            .update(transaction)
            .set({
              transferToAccountId: sourceAccountId,
              externalPaymentId: linkId,
              categoryId: data.categoryId as string,
              updatedAt: new Date(),
            })
            .where(eq(transaction.id, mirror.id));
        } else {
          await tx.insert(transaction).values({
            organizationId: orgId,
            accountId: destAccountId,
            categoryId: data.categoryId as string,
            kind: "income",
            amount: data.amount,
            description: data.description,
            occurredOn: data.occurredOn,
            notes: data.notes || null,
            transferToAccountId: sourceAccountId,
            externalPaymentId: linkId,
            createdById: userId,
            ownerId: destOwnerId,
          });
        }
      });
    }

    revalidatePath("/lancamentos");
    revalidatePath("/dashboard");
    revalidatePath("/cartoes");
    revalidatePath("/relatorios");
    return { success: true };
  }

  const isCreditCard = account.type === "credit_card";
  const installments = isCreditCard ? data.installments : 1;

  if (isCreditCard && (!account.closingDay || !account.dueDay)) {
    return {
      error: "Cartão sem dias de fechamento/vencimento configurados.",
    };
  }

  const userCategoryId =
    data.categoryId && data.categoryId !== "none" ? data.categoryId : null;
  const resolvedCategoryId =
    userCategoryId ??
    (await getAutoApplyCategoryId(orgId, data.kind, data.description));

  const tithable = data.kind === "income" && data.isTithable === "on";
  const reimbursableStatus: "none" | "pending" =
    data.kind === "expense" && data.isReimbursable === "on" ? "pending" : "none";

  await db.transaction(async (tx) => {
    if (!isCreditCard) {
      const [created] = await tx
        .insert(transaction)
        .values({
          organizationId: orgId,
          accountId: account.id,
          categoryId: resolvedCategoryId,
          kind: data.kind,
          amount: data.amount,
          description: data.description,
          occurredOn: data.occurredOn,
          notes: data.notes || null,
          isTithable: tithable,
          reimbursableStatus,
          createdById: userId,
          ownerId: account.ownerId,
        })
        .returning({ id: transaction.id });
      return;
    }

    const groupId = installments > 1 ? randomUUID() : null;
    const parts = divideAmount(data.amount, installments);
    const touchedInvoiceIds = new Set<string>();

    for (let i = 0; i < installments; i++) {
      const period = periodForDate(
        data.occurredOn,
        account.closingDay!,
        account.dueDay!,
        i,
      );

      const [existing] = await tx
        .select()
        .from(creditCardInvoice)
        .where(
          and(
            eq(creditCardInvoice.organizationId, orgId),
            eq(creditCardInvoice.accountId, account.id),
            eq(creditCardInvoice.periodEnd, period.periodEnd),
          ),
        )
        .limit(1);

      let invoiceId: string;
      if (existing) {
        invoiceId = existing.id;
      } else {
        const [created] = await tx
          .insert(creditCardInvoice)
          .values({
            organizationId: orgId,
            accountId: account.id,
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
            dueDate: period.dueDate,
            totalAmount: "0",
          })
          .returning({ id: creditCardInvoice.id });
        invoiceId = created.id;
      }

      const partAmount = parts[i];
      const description =
        installments > 1
          ? `${data.description} (${i + 1}/${installments})`
          : data.description;

      const [createdPart] = await tx
        .insert(transaction)
        .values({
          organizationId: orgId,
          accountId: account.id,
          categoryId: resolvedCategoryId,
          kind: data.kind,
          amount: partAmount,
          description,
          occurredOn: period.periodEnd,
          purchaseDate: data.occurredOn,
          notes: data.notes || null,
          isTithable: tithable,
          reimbursableStatus,
          creditCardInvoiceId: invoiceId,
          installmentGroupId: groupId,
          installmentNumber: installments > 1 ? i + 1 : null,
          installmentTotal: installments > 1 ? installments : null,
          createdById: userId,
          ownerId: account.ownerId,
        })
        .returning({ id: transaction.id });
      touchedInvoiceIds.add(invoiceId);
    }

    for (const invId of touchedInvoiceIds) {
      await recomputeInvoice(tx, invId);
    }
  });

  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  revalidatePath("/cartoes");
  return { success: true };
}

async function updateTransaction(
  formData: FormData,
): Promise<TransactionFormState> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  const role = await getMemberRole(orgId, userId);

  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? "_")] = issue.message;
    }
    return { error: "Verifique os campos.", fieldErrors };
  }

  const {
    id,
    accountId,
    categoryId,
    amount,
    cleanDescription,
    description,
    occurredOn,
    notes,
    transferToAccountId,
    isTithable: isTithableRaw,
    isReimbursable: isReimbursableRaw,
  } = parsed.data;
  const isTithableInput = isTithableRaw === "on";
  const isReimbursableInput = isReimbursableRaw === "on";

  let notFound = false;
  let validationError: string | null = null;
  let permissionDenied = false;

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(transaction)
      .where(
        and(eq(transaction.id, id), eq(transaction.organizationId, orgId)),
      )
      .limit(1);

    if (!existing) {
      notFound = true;
      return;
    }

    if (!canEdit({ ownerId: existing.ownerId }, userId, role)) {
      permissionDenied = true;
      return;
    }

    const isInstallment = existing.installmentNumber != null;
    const isCard = !!existing.creditCardInvoiceId;
    const finalAmount = isInstallment ? existing.amount : amount;
    const existingIsTransfer =
      !!existing.transferToAccountId ||
      (existing.externalPaymentId?.startsWith("transfer:") ?? false);

    // Detecta conversão pra transferência: categoria nova é is_transfer
    // e o lançamento atual ainda não é uma perna de transferência.
    let convertingToTransfer: {
      destAccountId: string;
      categoryId: string;
      linkId: string;
    } | null = null;
    const newCategoryIdRaw =
      categoryId && categoryId !== "none" ? categoryId : null;
    if (newCategoryIdRaw && !existingIsTransfer) {
      const [cat] = await tx
        .select({ isTransfer: category.isTransfer })
        .from(category)
        .where(
          and(
            eq(category.id, newCategoryIdRaw),
            eq(category.organizationId, orgId),
          ),
        )
        .limit(1);
      if (cat?.isTransfer) {
        if (isInstallment) {
          validationError =
            "Parcelas não podem virar transferência. Exclua e recrie.";
          return;
        }
        if (isCard) {
          validationError =
            "Lançamento de cartão não pode virar transferência. Exclua e recrie.";
          return;
        }
        if (!transferToAccountId) {
          validationError = "Selecione a conta destino/origem da transferência.";
          return;
        }
        convertingToTransfer = {
          destAccountId: transferToAccountId,
          categoryId: newCategoryIdRaw,
          linkId: `transfer:${randomUUID()}`,
        };
      }
    }

    // Conta nova: aceita troca apenas pra lançamentos sem invoice de cartão e
    // não-parcelas. Splits propagam pra filhas.
    let finalAccountId = existing.accountId;
    if (accountId && accountId !== existing.accountId) {
      if (isInstallment || isCard) {
        validationError =
          "Não é possível mover lançamento parcelado ou de cartão. Exclua e recrie.";
        return;
      }
      const [newAccount] = await tx
        .select()
        .from(financialAccount)
        .where(
          and(
            eq(financialAccount.id, accountId),
            eq(financialAccount.organizationId, orgId),
          ),
        )
        .limit(1);
      if (!newAccount) {
        validationError = "Conta de destino não encontrada.";
        return;
      }
      if (newAccount.type === "credit_card") {
        validationError =
          "Mover pra cartão de crédito não é suportado por aqui.";
        return;
      }
      finalAccountId = accountId;
    }

    const finalIsTithable =
      existing.kind === "income" ? isTithableInput : false;

    // Lógica do reimbursable_status no update:
    //  - kind!=expense: força "none"
    //  - kind=expense + checkbox marcado: se já era "received", preserva; senão "pending"
    //  - kind=expense + checkbox desmarcado: "none"
    const finalReimbursableStatus: "none" | "pending" | "received" =
      existing.kind !== "expense"
        ? "none"
        : isReimbursableInput
          ? existing.reimbursableStatus === "received"
            ? "received"
            : "pending"
          : "none";

    const newCategoryId =
      categoryId && categoryId !== "none" ? categoryId : null;
    await tx
      .update(transaction)
      .set({
        accountId: finalAccountId,
        categoryId: newCategoryId,
        amount: finalAmount,
        cleanDescription,
        description: description || cleanDescription,
        occurredOn: isCard ? existing.occurredOn : occurredOn,
        notes: notes || null,
        isTithable: finalIsTithable,
        reimbursableStatus: finalReimbursableStatus,
        updatedAt: new Date(),
      })
      .where(eq(transaction.id, id));

    // Recomputa a fatura se a transação está vinculada (compra ou pagamento).
    if (existing.creditCardInvoiceId) {
      await recomputeInvoice(tx, existing.creditCardInvoiceId);
    }
    if (existing.paidInvoiceId) {
      await recomputeInvoice(tx, existing.paidInvoiceId);
    }

    // Propaga troca de conta nas filhas de split
    if (finalAccountId !== existing.accountId) {
      await tx
        .update(transaction)
        .set({ accountId: finalAccountId, updatedAt: new Date() })
        .where(
          and(
            eq(transaction.organizationId, orgId),
            eq(transaction.parentTransactionId, id),
          ),
        );
    }

    // Conversão pra transferência: marca a perna existente e cria a espelhada
    if (convertingToTransfer) {
      if (convertingToTransfer.destAccountId === finalAccountId) {
        validationError =
          "Conta destino deve ser diferente da conta de origem.";
        return;
      }
      const [destAccount] = await tx
        .select()
        .from(financialAccount)
        .where(
          and(
            eq(financialAccount.id, convertingToTransfer.destAccountId),
            eq(financialAccount.organizationId, orgId),
          ),
        )
        .limit(1);
      if (!destAccount) {
        validationError = "Conta destino/origem não encontrada.";
        return;
      }
      if (destAccount.type === "credit_card") {
        validationError =
          "Transferências não podem destinar-se a cartão de crédito.";
        return;
      }

      const isCrossUser = destAccount.ownerId !== existing.ownerId;

      if (isCrossUser) {
        // Marca a perna existente como pendente de aceite pelo outro lado.
        await tx
          .update(transaction)
          .set({
            transferToAccountId: convertingToTransfer.destAccountId,
            externalPaymentId: convertingToTransfer.linkId,
            pendingStatus: "pending",
            requestedByUserId: userId,
            updatedAt: new Date(),
          })
          .where(eq(transaction.id, id));
      } else {
        // Same-user: marca a perna existente e cria/vincula a perna espelho.
        await tx
          .update(transaction)
          .set({
            transferToAccountId: convertingToTransfer.destAccountId,
            externalPaymentId: convertingToTransfer.linkId,
            updatedAt: new Date(),
          })
          .where(eq(transaction.id, id));

        const mirrorKind = existing.kind === "expense" ? "income" : "expense";
        const mirrorOccurredOn = isCard ? existing.occurredOn : occurredOn;

        // Tenta vincular a um lançamento já existente na conta destino antes
        // de criar uma nova perna (evita duplicação quando o user já importou
        // o extrato da outra conta).
        const mirror = await findTransferMirror(tx, orgId, {
          accountId: convertingToTransfer.destAccountId,
          kind: mirrorKind,
          amount: finalAmount,
          occurredOn: mirrorOccurredOn,
          excludeTxId: id,
        });

        if (mirror) {
          await tx
            .update(transaction)
            .set({
              transferToAccountId: finalAccountId,
              externalPaymentId: convertingToTransfer.linkId,
              categoryId: convertingToTransfer.categoryId,
              updatedAt: new Date(),
            })
            .where(eq(transaction.id, mirror.id));
        } else {
          await tx.insert(transaction).values({
            organizationId: orgId,
            accountId: convertingToTransfer.destAccountId,
            categoryId: convertingToTransfer.categoryId,
            kind: mirrorKind,
            amount: finalAmount,
            description: description || cleanDescription,
            cleanDescription,
            occurredOn: mirrorOccurredOn,
            notes: notes || null,
            transferToAccountId: finalAccountId,
            externalPaymentId: convertingToTransfer.linkId,
            createdById: existing.createdById,
            ownerId: destAccount.ownerId,
          });
        }
      }
    }
  });

  if (notFound) return { error: "Lançamento não encontrado." };
  if (permissionDenied) return { error: "Sem permissão para editar este lançamento." };
  if (validationError) return { error: validationError };

  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  revalidatePath("/cartoes");
  revalidatePath("/relatorios");
  return { success: true };
}

export type BulkInlineUpdate = {
  ids: string[];
  cleanDescription?: string;
  categoryId?: string | null;
};

export async function bulkUpdateInlineAction(
  updates: BulkInlineUpdate[],
): Promise<{ ok: true } | { error: string }> {
  if (updates.length === 0) return { ok: true };

  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  const role = await getMemberRole(orgId, userId);

  for (const u of updates) {
    if (!Array.isArray(u.ids) || u.ids.length === 0) {
      return { error: "Atualização sem IDs." };
    }
    if (
      u.cleanDescription !== undefined &&
      (u.cleanDescription.length === 0 || u.cleanDescription.length > 200)
    ) {
      return { error: "Descrição inválida (1–200 caracteres)." };
    }
  }

  // Coleta todas as transações alvo e valida permissão por owner
  const allIds = updates.flatMap((u) => u.ids);
  const targets = await db
    .select({
      id: transaction.id,
      ownerId: transaction.ownerId,
      kind: transaction.kind,
    })
    .from(transaction)
    .where(
      and(
        eq(transaction.organizationId, orgId),
        inArray(transaction.id, allIds),
      ),
    );
  for (const t of targets) {
    if (!canEdit({ ownerId: t.ownerId }, userId, role)) {
      return { error: "Sem permissão para editar um dos lançamentos selecionados." };
    }
  }

  await db.transaction(async (tx) => {
    for (const u of updates) {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (u.cleanDescription !== undefined)
        set.cleanDescription = u.cleanDescription;
      if (u.categoryId !== undefined) set.categoryId = u.categoryId;

      if (Object.keys(set).length === 1) continue; // só updatedAt — pula

      await tx
        .update(transaction)
        .set(set)
        .where(
          and(
            eq(transaction.organizationId, orgId),
            inArray(transaction.id, u.ids),
          ),
        );

    }
  });

  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  revalidatePath("/cartoes");
  revalidatePath("/relatorios");
  return { ok: true };
}

export async function findSimilarUncategorizedAction(
  referenceTxId: string,
): Promise<SimilarLookup> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  return findSimilarUncategorizedTransactions(orgId, referenceTxId);
}

export async function deleteTransactionAction(formData: FormData) {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  const role = await getMemberRole(orgId, userId);
  const ids = formData.getAll("id").map(String).filter(Boolean);
  if (ids.length === 0) return;

  // mode: "cascade" (default) deleta o par; "keep_pair" mantém a outra ponta
  // como lançamento simples (limpa transferToAccountId + externalPaymentId).
  const mode = String(formData.get("mode") ?? "cascade");
  const keepPair = mode === "keep_pair";

  await db.transaction(async (tx) => {
    const deleted = new Set<string>();
    const queue = [...ids];

    while (queue.length > 0) {
      const id = queue.shift()!;
      if (deleted.has(id)) continue;

      const [existing] = await tx
        .select()
        .from(transaction)
        .where(
          and(eq(transaction.id, id), eq(transaction.organizationId, orgId)),
        )
        .limit(1);

      if (!existing) continue;
      if (!canEdit({ ownerId: existing.ownerId }, userId, role)) {
        throw new PermissionDeniedError(
          "Sem permissão para excluir este lançamento.",
        );
      }

      // Tratamento de transferência: encontra o par pelo external_payment_id
      if (
        existing.externalPaymentId &&
        existing.externalPaymentId.startsWith("transfer:")
      ) {
        const pair = await tx
          .select({ id: transaction.id })
          .from(transaction)
          .where(
            and(
              eq(transaction.organizationId, orgId),
              eq(transaction.externalPaymentId, existing.externalPaymentId),
            ),
          );
        const partners = pair.map((p) => p.id).filter((pid) => pid !== id);

        if (keepPair) {
          // Mantém parceiro como lançamento simples
          if (partners.length > 0) {
            await tx
              .update(transaction)
              .set({
                transferToAccountId: null,
                externalPaymentId: null,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(transaction.organizationId, orgId),
                  inArray(transaction.id, partners),
                ),
              );
          }
        } else {
          for (const pid of partners) {
            if (!deleted.has(pid)) queue.push(pid);
          }
        }
      }

      const invIdsToRecompute = new Set<string>();
      if (existing.creditCardInvoiceId)
        invIdsToRecompute.add(existing.creditCardInvoiceId);
      if (existing.paidInvoiceId)
        invIdsToRecompute.add(existing.paidInvoiceId);

      await tx.delete(transaction).where(eq(transaction.id, id));
      deleted.add(id);

      for (const invId of invIdsToRecompute) {
        await recomputeInvoice(tx, invId);
      }
    }
  });

  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  revalidatePath("/cartoes");
  revalidatePath("/relatorios");
}
