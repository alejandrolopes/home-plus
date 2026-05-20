"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  financialAccount,
  reimbursement,
  transaction,
} from "@/db/schema/finance";
import { canEdit, getMemberRole } from "@/lib/auth-permissions";
import { requireOrganization } from "@/lib/guards";

type Result = { ok: true } | { error: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function settleReimbursementAction(
  reimbursementId: string,
  incomeTxId: string,
): Promise<Result> {
  if (!UUID_RE.test(reimbursementId) || !UUID_RE.test(incomeTxId)) {
    return { error: "Identificadores inválidos." };
  }
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  const role = await getMemberRole(orgId, userId);

  const [r] = await db
    .select({
      id: reimbursement.id,
      expenseTxId: reimbursement.expenseTxId,
      incomeTxId: reimbursement.incomeTxId,
    })
    .from(reimbursement)
    .where(
      and(
        eq(reimbursement.id, reimbursementId),
        eq(reimbursement.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!r) return { error: "Reembolso não encontrado." };
  if (r.incomeTxId) return { error: "Reembolso já está vinculado." };

  const [incomeTx] = await db
    .select({
      id: transaction.id,
      kind: transaction.kind,
      ownerId: transaction.ownerId,
      transferToAccountId: transaction.transferToAccountId,
    })
    .from(transaction)
    .where(
      and(
        eq(transaction.id, incomeTxId),
        eq(transaction.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!incomeTx) return { error: "Receita não encontrada." };
  if (incomeTx.kind !== "income") return { error: "Selecione uma receita." };
  if (incomeTx.transferToAccountId)
    return { error: "Transferências não podem ser usadas como reembolso." };
  if (!canEdit({ ownerId: incomeTx.ownerId }, userId, role)) {
    return { error: "Sem permissão para usar essa receita." };
  }

  await db
    .update(reimbursement)
    .set({ incomeTxId, updatedAt: new Date() })
    .where(eq(reimbursement.id, reimbursementId));

  revalidatePath("/reembolsos");
  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function unsettleReimbursementAction(
  reimbursementId: string,
): Promise<Result> {
  if (!UUID_RE.test(reimbursementId)) {
    return { error: "Identificador inválido." };
  }
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  await db
    .update(reimbursement)
    .set({ incomeTxId: null, updatedAt: new Date() })
    .where(
      and(
        eq(reimbursement.id, reimbursementId),
        eq(reimbursement.organizationId, orgId),
      ),
    );

  revalidatePath("/reembolsos");
  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function createIncomeForReimbursementAction(
  reimbursementId: string,
  accountId: string,
  occurredOn: string,
): Promise<Result> {
  if (!UUID_RE.test(reimbursementId) || !UUID_RE.test(accountId)) {
    return { error: "Identificadores inválidos." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) {
    return { error: "Data inválida." };
  }
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  const role = await getMemberRole(orgId, userId);

  const [r] = await db
    .select({
      id: reimbursement.id,
      expenseTxId: reimbursement.expenseTxId,
      incomeTxId: reimbursement.incomeTxId,
      expectedFrom: reimbursement.expectedFrom,
    })
    .from(reimbursement)
    .where(
      and(
        eq(reimbursement.id, reimbursementId),
        eq(reimbursement.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!r) return { error: "Reembolso não encontrado." };
  if (r.incomeTxId) return { error: "Reembolso já está vinculado." };

  const [expenseTx] = await db
    .select({
      id: transaction.id,
      amount: transaction.amount,
      description: transaction.description,
      cleanDescription: transaction.cleanDescription,
    })
    .from(transaction)
    .where(
      and(
        eq(transaction.id, r.expenseTxId),
        eq(transaction.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!expenseTx) return { error: "Despesa original não encontrada." };

  const [acc] = await db
    .select({ id: financialAccount.id, ownerId: financialAccount.ownerId })
    .from(financialAccount)
    .where(
      and(
        eq(financialAccount.id, accountId),
        eq(financialAccount.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!acc) return { error: "Conta não encontrada." };
  if (!canEdit({ ownerId: acc.ownerId }, userId, role)) {
    return { error: "Sem permissão para criar receita nessa conta." };
  }

  const refLabel =
    expenseTx.cleanDescription ?? expenseTx.description ?? "compra";
  const description =
    `Reembolso${r.expectedFrom ? ` ${r.expectedFrom}` : ""} — ${refLabel}`.slice(
      0,
      200,
    );

  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(transaction)
      .values({
        organizationId: orgId,
        accountId: acc.id,
        categoryId: null,
        kind: "income",
        amount: expenseTx.amount,
        description,
        cleanDescription: description,
        occurredOn,
        notes: null,
        createdById: userId,
        ownerId: acc.ownerId,
      })
      .returning({ id: transaction.id });

    await tx
      .update(reimbursement)
      .set({ incomeTxId: created.id, updatedAt: new Date() })
      .where(eq(reimbursement.id, reimbursementId));
  });

  revalidatePath("/reembolsos");
  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function updateReimbursementMetaAction(
  reimbursementId: string,
  data: { expectedFrom?: string; notes?: string },
): Promise<Result> {
  if (!UUID_RE.test(reimbursementId)) {
    return { error: "Identificador inválido." };
  }
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (data.expectedFrom !== undefined) {
    set.expectedFrom = data.expectedFrom.trim() || null;
  }
  if (data.notes !== undefined) {
    set.notes = data.notes.trim() || null;
  }

  await db
    .update(reimbursement)
    .set(set)
    .where(
      and(
        eq(reimbursement.id, reimbursementId),
        eq(reimbursement.organizationId, orgId),
      ),
    );

  revalidatePath("/reembolsos");
  return { ok: true };
}
