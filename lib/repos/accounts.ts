import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema/auth";
import { financialAccount, transaction } from "@/db/schema/finance";

export type FinancialAccount = typeof financialAccount.$inferSelect;

export type FamilyAccountForTransfer = {
  id: string;
  name: string;
  type: "checking" | "savings" | "cash" | "credit_card" | "investment";
  ownerId: string;
  ownerName: string;
};

export async function listFamilyAccountsForTransfer(
  orgId: string,
): Promise<FamilyAccountForTransfer[]> {
  const rows = await db
    .select({
      id: financialAccount.id,
      name: financialAccount.name,
      type: financialAccount.type,
      ownerId: financialAccount.ownerId,
      ownerName: user.name,
    })
    .from(financialAccount)
    .innerJoin(user, eq(financialAccount.ownerId, user.id))
    .where(
      and(
        eq(financialAccount.organizationId, orgId),
        eq(financialAccount.archived, false),
        sql`${financialAccount.type} != 'credit_card'`,
      ),
    )
    .orderBy(asc(user.name), asc(financialAccount.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    ownerId: r.ownerId,
    ownerName: r.ownerName,
  }));
}

export async function listAccounts(
  orgId: string,
  options: {
    includeArchived?: boolean;
    archivedOnly?: boolean;
    ownerId?: string;
  } = {},
) {
  const where = [eq(financialAccount.organizationId, orgId)];
  if (options.archivedOnly) {
    where.push(eq(financialAccount.archived, true));
  } else if (!options.includeArchived) {
    where.push(eq(financialAccount.archived, false));
  }
  if (options.ownerId) {
    where.push(eq(financialAccount.ownerId, options.ownerId));
  }
  return db
    .select()
    .from(financialAccount)
    .where(and(...where))
    .orderBy(asc(financialAccount.name));
}

export async function countAccountsByState(
  orgId: string,
  options: { ownerId?: string } = {},
): Promise<{ active: number; archived: number }> {
  const where = [eq(financialAccount.organizationId, orgId)];
  if (options.ownerId) {
    where.push(eq(financialAccount.ownerId, options.ownerId));
  }
  const rows = await db
    .select({
      archived: financialAccount.archived,
      count: sql<number>`COUNT(*)`,
    })
    .from(financialAccount)
    .where(and(...where))
    .groupBy(financialAccount.archived);
  let active = 0;
  let archived = 0;
  for (const r of rows) {
    if (r.archived) archived = Number(r.count);
    else active = Number(r.count);
  }
  return { active, archived };
}

export async function transactionCountsByAccount(
  orgId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      accountId: transaction.accountId,
      count: sql<number>`COUNT(*)`,
    })
    .from(transaction)
    .where(eq(transaction.organizationId, orgId))
    .groupBy(transaction.accountId);
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.accountId) map.set(r.accountId, Number(r.count));
  }
  return map;
}

export async function getAccount(orgId: string, id: string) {
  const [row] = await db
    .select()
    .from(financialAccount)
    .where(
      and(
        eq(financialAccount.organizationId, orgId),
        eq(financialAccount.id, id),
      ),
    )
    .limit(1);
  return row ?? null;
}
