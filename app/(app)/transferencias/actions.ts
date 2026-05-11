"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { financialAccount, transaction } from "@/db/schema/finance";
import { requireOrganization } from "@/lib/guards";

type ActionResult = { success: true } | { error: string };

type LoadPendingResult =
  | { ok: false; error: string }
  | {
      ok: true;
      pending: {
        id: string;
        accountId: string | null;
        kind: "income" | "expense" | "transfer";
        amount: string;
        occurredOn: string;
        description: string;
        notes: string | null;
        categoryId: string | null;
        transferToAccountId: string | null;
        externalPaymentId: string | null;
        pendingStatus: "pending" | null;
        ownerId: string;
      };
      destAcc: {
        id: string;
        ownerId: string;
        type: "checking" | "savings" | "cash" | "credit_card" | "investment";
      };
    };

async function loadPending(
  orgId: string,
  pendingId: string,
  userId: string,
): Promise<LoadPendingResult> {
  const [row] = await db
    .select({
      id: transaction.id,
      accountId: transaction.accountId,
      kind: transaction.kind,
      amount: transaction.amount,
      occurredOn: transaction.occurredOn,
      description: transaction.description,
      notes: transaction.notes,
      categoryId: transaction.categoryId,
      transferToAccountId: transaction.transferToAccountId,
      externalPaymentId: transaction.externalPaymentId,
      pendingStatus: transaction.pendingStatus,
      ownerId: transaction.ownerId,
    })
    .from(transaction)
    .where(
      and(eq(transaction.id, pendingId), eq(transaction.organizationId, orgId)),
    )
    .limit(1);
  if (!row) return { ok: false, error: "Transferência não encontrada." };
  if (row.pendingStatus !== "pending") {
    return { ok: false, error: "Esta transferência não está mais pendente." };
  }
  if (!row.transferToAccountId) {
    return { ok: false, error: "Transferência sem conta destino." };
  }

  const [destAcc] = await db
    .select({
      id: financialAccount.id,
      ownerId: financialAccount.ownerId,
      type: financialAccount.type,
    })
    .from(financialAccount)
    .where(eq(financialAccount.id, row.transferToAccountId))
    .limit(1);
  if (!destAcc) return { ok: false, error: "Conta destino não encontrada." };
  if (destAcc.ownerId !== userId) {
    return { ok: false, error: "Sem permissão para aceitar esta transferência." };
  }

  return { ok: true, pending: row, destAcc };
}

const acceptCreateSchema = z.object({
  pendingId: z.string().uuid(),
  destAccountId: z.string().uuid(),
});

export async function acceptTransferCreateAction(
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const parsed = acceptCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Dados inválidos." };
  const { pendingId, destAccountId } = parsed.data;

  const result = await loadPending(orgId, pendingId, userId);
  if (!result.ok) return { error: result.error };
  const { pending } = result;

  // Conta escolhida pelo aceitante. Por padrão usa transferToAccountId, mas
  // permitimos trocar para qualquer conta dele.
  const [chosen] = await db
    .select()
    .from(financialAccount)
    .where(
      and(
        eq(financialAccount.id, destAccountId),
        eq(financialAccount.organizationId, orgId),
        eq(financialAccount.ownerId, userId),
      ),
    )
    .limit(1);
  if (!chosen) return { error: "Conta destino inválida." };
  if (chosen.type === "credit_card") {
    return {
      error: "Transferências não podem destinar-se a cartão de crédito.",
    };
  }

  const myKind: "income" | "expense" =
    pending.kind === "expense" ? "income" : "expense";

  const sourceAccountId = pending.accountId;

  await db.transaction(async (tx) => {
    // Cria a perna do aceitante já apontando para a conta da perna fonte
    await tx.insert(transaction).values({
      organizationId: orgId,
      accountId: chosen.id,
      categoryId: pending.categoryId,
      kind: myKind,
      amount: pending.amount,
      description: pending.description,
      occurredOn: pending.occurredOn,
      notes: pending.notes,
      transferToAccountId: sourceAccountId,
      externalPaymentId: pending.externalPaymentId,
      createdById: userId,
      ownerId: userId,
    });

    // Atualiza a perna fonte: aponta para a conta escolhida e libera pending
    await tx
      .update(transaction)
      .set({
        transferToAccountId: chosen.id,
        pendingStatus: null,
        updatedAt: new Date(),
      })
      .where(eq(transaction.id, pending.id));
  });

  revalidatePath("/transferencias");
  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  return { success: true };
}

const acceptLinkSchema = z.object({
  pendingId: z.string().uuid(),
  candidateId: z.string().uuid(),
});

export async function acceptTransferLinkAction(
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const parsed = acceptLinkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Dados inválidos." };
  const { pendingId, candidateId } = parsed.data;

  const result = await loadPending(orgId, pendingId, userId);
  if (!result.ok) return { error: result.error };
  const { pending } = result;

  // Carrega o candidato e valida que pertence ao usuário e está livre.
  const [candidate] = await db
    .select({
      id: transaction.id,
      accountId: transaction.accountId,
      amount: transaction.amount,
      kind: transaction.kind,
      transferToAccountId: transaction.transferToAccountId,
      parentTransactionId: transaction.parentTransactionId,
      creditCardInvoiceId: transaction.creditCardInvoiceId,
      paidInvoiceId: transaction.paidInvoiceId,
      pendingStatus: transaction.pendingStatus,
      accountOwnerId: financialAccount.ownerId,
    })
    .from(transaction)
    .innerJoin(
      financialAccount,
      eq(transaction.accountId, financialAccount.id),
    )
    .where(
      and(
        eq(transaction.id, candidateId),
        eq(transaction.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!candidate) return { error: "Lançamento candidato não encontrado." };
  if (candidate.accountOwnerId !== userId) {
    return { error: "Lançamento candidato não pertence ao seu usuário." };
  }
  if (candidate.amount !== pending.amount) {
    return { error: "Valor do candidato difere da transferência." };
  }
  const expectedKind = pending.kind === "expense" ? "income" : "expense";
  if (candidate.kind !== expectedKind) {
    return { error: "Tipo do candidato não casa com a transferência." };
  }
  if (
    candidate.transferToAccountId ||
    candidate.parentTransactionId ||
    candidate.creditCardInvoiceId ||
    candidate.paidInvoiceId ||
    candidate.pendingStatus
  ) {
    return { error: "Lançamento já vinculado a outra movimentação." };
  }

  // Source account = conta da perna pendente
  const [sourcePerna] = await db
    .select({ accountId: transaction.accountId })
    .from(transaction)
    .where(eq(transaction.id, pending.id))
    .limit(1);

  await db.transaction(async (tx) => {
    // Vincula candidato à transferência
    await tx
      .update(transaction)
      .set({
        transferToAccountId: sourcePerna?.accountId ?? null,
        externalPaymentId: pending.externalPaymentId,
        categoryId: pending.categoryId,
        updatedAt: new Date(),
      })
      .where(eq(transaction.id, candidate.id));

    // Aponta a perna pendente pra conta do candidato e libera pending
    await tx
      .update(transaction)
      .set({
        transferToAccountId: candidate.accountId,
        pendingStatus: null,
        updatedAt: new Date(),
      })
      .where(eq(transaction.id, pending.id));
  });

  revalidatePath("/transferencias");
  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  return { success: true };
}

const rejectSchema = z.object({
  pendingId: z.string().uuid(),
});

export async function rejectTransferAction(
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const parsed = rejectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Dados inválidos." };
  const { pendingId } = parsed.data;

  const result = await loadPending(orgId, pendingId, userId);
  if (!result.ok) return { error: result.error };
  const { pending } = result;

  // Recusa: a perna do criador permanece, mas vira despesa/receita avulsa.
  await db
    .update(transaction)
    .set({
      transferToAccountId: null,
      externalPaymentId: null,
      pendingStatus: null,
      updatedAt: new Date(),
    })
    .where(eq(transaction.id, pending.id));

  revalidatePath("/transferencias");
  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  return { success: true };
}
