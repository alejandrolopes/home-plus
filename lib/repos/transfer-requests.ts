import "server-only";

import { and, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema/auth";
import {
  category,
  financialAccount,
  transaction,
} from "@/db/schema/finance";

export type PendingTransferRequest = {
  id: string;
  amount: string;
  occurredOn: string;
  description: string;
  notes: string | null;
  kind: "income" | "expense";
  externalPaymentId: string | null;
  requestedByUserId: string | null;
  requesterName: string | null;
  sourceAccount: { id: string; name: string; ownerId: string } | null;
  destAccount: { id: string; name: string; ownerId: string } | null;
  category: { id: string; name: string; color: string | null } | null;
};

/**
 * Lista transferências pendentes onde o usuário é o destinatário (a perna foi
 * criada por outro membro e está aguardando ele aceitar/recusar).
 */
export async function listPendingTransfersForUser(
  orgId: string,
  userId: string,
): Promise<PendingTransferRequest[]> {
  const rows = await db
    .select({
      id: transaction.id,
      amount: transaction.amount,
      occurredOn: transaction.occurredOn,
      description: transaction.description,
      notes: transaction.notes,
      kind: transaction.kind,
      externalPaymentId: transaction.externalPaymentId,
      requestedByUserId: transaction.requestedByUserId,
      requesterName: user.name,
      sourceAccountId: transaction.accountId,
      sourceAccountName: financialAccount.name,
      sourceAccountOwnerId: financialAccount.ownerId,
      destAccountId: transaction.transferToAccountId,
      categoryId: transaction.categoryId,
      categoryName: category.name,
      categoryColor: category.color,
    })
    .from(transaction)
    .leftJoin(financialAccount, eq(transaction.accountId, financialAccount.id))
    .leftJoin(category, eq(transaction.categoryId, category.id))
    .leftJoin(user, eq(transaction.requestedByUserId, user.id))
    .where(
      and(
        eq(transaction.organizationId, orgId),
        eq(transaction.pendingStatus, "pending"),
        sql`${transaction.transferToAccountId} IN (
          SELECT id FROM ${financialAccount}
          WHERE owner_id = ${userId}
            AND organization_id = ${orgId}
        )`,
      ),
    )
    .orderBy(transaction.occurredOn);

  // 2ª query: dados da conta destino (única).
  const destIds = Array.from(
    new Set(rows.map((r) => r.destAccountId).filter((x): x is string => !!x)),
  );
  const destMap = new Map<
    string,
    { id: string; name: string; ownerId: string }
  >();
  if (destIds.length) {
    const destRows = await db
      .select({
        id: financialAccount.id,
        name: financialAccount.name,
        ownerId: financialAccount.ownerId,
      })
      .from(financialAccount)
      .where(inArray(financialAccount.id, destIds));
    for (const d of destRows) destMap.set(d.id, d);
  }

  return rows.map((r) => ({
    id: r.id,
    amount: r.amount,
    occurredOn: r.occurredOn,
    description: r.description,
    notes: r.notes,
    kind: r.kind === "transfer" ? "expense" : (r.kind as "income" | "expense"),
    externalPaymentId: r.externalPaymentId,
    requestedByUserId: r.requestedByUserId,
    requesterName: r.requesterName,
    sourceAccount:
      r.sourceAccountId && r.sourceAccountName
        ? {
            id: r.sourceAccountId,
            name: r.sourceAccountName,
            ownerId: r.sourceAccountOwnerId ?? "",
          }
        : null,
    destAccount: r.destAccountId ? destMap.get(r.destAccountId) ?? null : null,
    category: r.categoryId
      ? {
          id: r.categoryId,
          name: r.categoryName ?? "",
          color: r.categoryColor,
        }
      : null,
  }));
}

export async function countPendingTransfersForUser(
  orgId: string,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(transaction)
    .where(
      and(
        eq(transaction.organizationId, orgId),
        eq(transaction.pendingStatus, "pending"),
        sql`${transaction.transferToAccountId} IN (
          SELECT id FROM ${financialAccount}
          WHERE owner_id = ${userId}
            AND organization_id = ${orgId}
        )`,
      ),
    );
  return row?.total ?? 0;
}

export type TransferLinkCandidate = {
  id: string;
  amount: string;
  occurredOn: string;
  description: string;
  accountId: string;
  accountName: string;
};

const LINK_WINDOW_DAYS = 14;

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Lança candidatos a vinculação para um pending: lançamentos do destinatário
 * de mesmo valor e kind oposto ao da perna pendente, em janela de ±14 dias,
 * que ainda não estejam atrelados a outra transferência ou cartão.
 */
export async function listLinkCandidatesForPending(
  orgId: string,
  pendingId: string,
  userId: string,
): Promise<TransferLinkCandidate[]> {
  const [pending] = await db
    .select({
      id: transaction.id,
      amount: transaction.amount,
      occurredOn: transaction.occurredOn,
      kind: transaction.kind,
      transferToAccountId: transaction.transferToAccountId,
      pendingStatus: transaction.pendingStatus,
    })
    .from(transaction)
    .where(
      and(
        eq(transaction.id, pendingId),
        eq(transaction.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!pending || pending.pendingStatus !== "pending") return [];
  if (!pending.transferToAccountId) return [];

  // Confirma que a conta destino é do usuário
  const [destAcc] = await db
    .select({ ownerId: financialAccount.ownerId })
    .from(financialAccount)
    .where(eq(financialAccount.id, pending.transferToAccountId))
    .limit(1);
  if (!destAcc || destAcc.ownerId !== userId) return [];

  const oppositeKind = pending.kind === "expense" ? "income" : "expense";
  const fromIso = shiftIso(pending.occurredOn, -LINK_WINDOW_DAYS);
  const toIso = shiftIso(pending.occurredOn, LINK_WINDOW_DAYS);

  const rows = await db
    .select({
      id: transaction.id,
      amount: transaction.amount,
      occurredOn: transaction.occurredOn,
      description: transaction.description,
      accountId: financialAccount.id,
      accountName: financialAccount.name,
    })
    .from(transaction)
    .innerJoin(
      financialAccount,
      eq(transaction.accountId, financialAccount.id),
    )
    .where(
      and(
        eq(transaction.organizationId, orgId),
        eq(transaction.kind, oppositeKind),
        eq(transaction.amount, pending.amount),
        eq(financialAccount.ownerId, userId),
        ne(transaction.id, pending.id),
        isNull(transaction.transferToAccountId),
        isNull(transaction.parentTransactionId),
        isNull(transaction.creditCardInvoiceId),
        isNull(transaction.paidInvoiceId),
        isNull(transaction.pendingStatus),
        gte(transaction.occurredOn, fromIso),
        lte(transaction.occurredOn, toIso),
      ),
    )
    .orderBy(transaction.occurredOn);

  return rows.map((r) => ({
    id: r.id,
    amount: r.amount,
    occurredOn: r.occurredOn,
    description: r.description,
    accountId: r.accountId,
    accountName: r.accountName,
  }));
}

