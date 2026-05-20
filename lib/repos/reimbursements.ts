import "server-only";

import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  category,
  financialAccount,
  reimbursement,
  transaction,
} from "@/db/schema/finance";

type DbExecutor = Pick<typeof db, "select" | "insert" | "update" | "delete">;

/**
 * Garante que o registro em `reimbursement` reflita o estado atual da
 * transação. Chamado depois de criar/editar lançamentos.
 *
 * Regras:
 *  - kind != expense ou sem categoria → remove qualquer reimbursement pending
 *    (mantém os já reembolsados, para preservar histórico).
 *  - Categoria com is_reimbursable=true → insere reimbursement (idempotente).
 *  - Categoria com is_reimbursable=false → remove pending; mantém reembolsado.
 */
export async function syncReimbursementForTransaction(
  tx: DbExecutor,
  orgId: string,
  params: {
    expenseTxId: string;
    kind: "income" | "expense" | "transfer";
    categoryId: string | null;
  },
): Promise<void> {
  if (params.kind !== "expense" || !params.categoryId) {
    await tx
      .delete(reimbursement)
      .where(
        and(
          eq(reimbursement.organizationId, orgId),
          eq(reimbursement.expenseTxId, params.expenseTxId),
          isNull(reimbursement.incomeTxId),
        ),
      );
    return;
  }

  const [cat] = await tx
    .select({
      name: category.name,
      isReimbursable: category.isReimbursable,
    })
    .from(category)
    .where(
      and(
        eq(category.id, params.categoryId),
        eq(category.organizationId, orgId),
      ),
    )
    .limit(1);

  if (!cat) return;

  if (cat.isReimbursable) {
    await tx
      .insert(reimbursement)
      .values({
        organizationId: orgId,
        expenseTxId: params.expenseTxId,
        expectedFrom: cat.name,
      })
      .onConflictDoNothing();
  } else {
    await tx
      .delete(reimbursement)
      .where(
        and(
          eq(reimbursement.organizationId, orgId),
          eq(reimbursement.expenseTxId, params.expenseTxId),
          isNull(reimbursement.incomeTxId),
        ),
      );
  }
}

export type ReimbursementRow = {
  id: string;
  status: "pending" | "reimbursed";
  expectedFrom: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  expense: {
    id: string;
    description: string;
    cleanDescription: string | null;
    amount: string;
    occurredOn: string;
    accountId: string | null;
    accountName: string | null;
    accountColor: string | null;
    accountType: string | null;
    categoryId: string | null;
    categoryName: string | null;
    categoryColor: string | null;
  };
  income: {
    id: string;
    description: string;
    cleanDescription: string | null;
    amount: string;
    occurredOn: string;
    accountId: string | null;
    accountName: string | null;
  } | null;
};

export type ReimbursementListFilters = {
  status?: "pending" | "reimbursed";
};

export async function listReimbursements(
  orgId: string,
  filters: ReimbursementListFilters = {},
): Promise<ReimbursementRow[]> {
  const incomeTx = alias(transaction, "income_tx");
  const incomeAccount = alias(financialAccount, "income_account");

  const where = [eq(reimbursement.organizationId, orgId)];
  if (filters.status === "pending") {
    where.push(isNull(reimbursement.incomeTxId));
  } else if (filters.status === "reimbursed") {
    where.push(isNotNull(reimbursement.incomeTxId));
  }

  const rows = await db
    .select({
      id: reimbursement.id,
      expectedFrom: reimbursement.expectedFrom,
      notes: reimbursement.notes,
      createdAt: reimbursement.createdAt,
      updatedAt: reimbursement.updatedAt,
      incomeTxId: reimbursement.incomeTxId,
      expenseId: transaction.id,
      expenseDescription: transaction.description,
      expenseCleanDescription: transaction.cleanDescription,
      expenseAmount: transaction.amount,
      expenseOccurredOn: transaction.occurredOn,
      expenseAccountId: transaction.accountId,
      expenseCategoryId: transaction.categoryId,
      accountName: financialAccount.name,
      accountColor: financialAccount.color,
      accountType: financialAccount.type,
      categoryName: category.name,
      categoryColor: category.color,
      incomeId: incomeTx.id,
      incomeDescription: incomeTx.description,
      incomeCleanDescription: incomeTx.cleanDescription,
      incomeAmount: incomeTx.amount,
      incomeOccurredOn: incomeTx.occurredOn,
      incomeAccountId: incomeTx.accountId,
      incomeAccountName: incomeAccount.name,
    })
    .from(reimbursement)
    .innerJoin(transaction, eq(transaction.id, reimbursement.expenseTxId))
    .leftJoin(
      financialAccount,
      eq(financialAccount.id, transaction.accountId),
    )
    .leftJoin(category, eq(category.id, transaction.categoryId))
    .leftJoin(incomeTx, eq(incomeTx.id, reimbursement.incomeTxId))
    .leftJoin(incomeAccount, eq(incomeAccount.id, incomeTx.accountId))
    .where(and(...where))
    .orderBy(desc(reimbursement.createdAt));

  return rows.map((r) => ({
    id: r.id,
    status: r.incomeTxId ? "reimbursed" : "pending",
    expectedFrom: r.expectedFrom,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    expense: {
      id: r.expenseId,
      description: r.expenseDescription,
      cleanDescription: r.expenseCleanDescription,
      amount: r.expenseAmount,
      occurredOn: r.expenseOccurredOn,
      accountId: r.expenseAccountId,
      accountName: r.accountName,
      accountColor: r.accountColor,
      accountType: r.accountType,
      categoryId: r.expenseCategoryId,
      categoryName: r.categoryName,
      categoryColor: r.categoryColor,
    },
    income: r.incomeId
      ? {
          id: r.incomeId,
          description: r.incomeDescription ?? "",
          cleanDescription: r.incomeCleanDescription,
          amount: r.incomeAmount ?? "0",
          occurredOn: r.incomeOccurredOn ?? "",
          accountId: r.incomeAccountId,
          accountName: r.incomeAccountName,
        }
      : null,
  }));
}

export type IncomeCandidate = {
  id: string;
  description: string;
  cleanDescription: string | null;
  amount: string;
  occurredOn: string;
  accountId: string | null;
  accountName: string | null;
  accountColor: string | null;
};

/**
 * Lista lançamentos de receita (income) candidatos a vincular a um reembolso.
 * Critérios: mesma org, não-transferência, não-split-child, não atualmente
 * vinculados a outro reembolso, dentro de janela de 90 dias.
 */
export async function listIncomeCandidatesForReimbursement(
  orgId: string,
  options: { amount?: string; sinceDays?: number } = {},
): Promise<IncomeCandidate[]> {
  const sinceDays = options.sinceDays ?? 90;
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);
  const sinceISO = since.toISOString().slice(0, 10);

  const where = [
    eq(transaction.organizationId, orgId),
    eq(transaction.kind, "income"),
    isNull(transaction.transferToAccountId),
    isNull(transaction.parentTransactionId),
    sql`${transaction.occurredOn} >= ${sinceISO}`,
    sql`NOT EXISTS (
      SELECT 1 FROM ${reimbursement} r
      WHERE r.income_tx_id = ${transaction.id}
    )`,
  ];
  if (options.amount) {
    where.push(eq(transaction.amount, options.amount));
  }

  const rows = await db
    .select({
      id: transaction.id,
      description: transaction.description,
      cleanDescription: transaction.cleanDescription,
      amount: transaction.amount,
      occurredOn: transaction.occurredOn,
      accountId: transaction.accountId,
      accountName: financialAccount.name,
      accountColor: financialAccount.color,
    })
    .from(transaction)
    .leftJoin(financialAccount, eq(financialAccount.id, transaction.accountId))
    .where(and(...where))
    .orderBy(desc(transaction.occurredOn))
    .limit(50);

  return rows.map((r) => ({
    id: r.id,
    description: r.description,
    cleanDescription: r.cleanDescription,
    amount: r.amount,
    occurredOn: r.occurredOn,
    accountId: r.accountId,
    accountName: r.accountName,
    accountColor: r.accountColor,
  }));
}

export async function getReimbursementByExpenseTxId(
  orgId: string,
  expenseTxId: string,
): Promise<{
  id: string;
  expenseTxId: string;
  incomeTxId: string | null;
  expectedFrom: string | null;
  notes: string | null;
} | null> {
  const [r] = await db
    .select({
      id: reimbursement.id,
      expenseTxId: reimbursement.expenseTxId,
      incomeTxId: reimbursement.incomeTxId,
      expectedFrom: reimbursement.expectedFrom,
      notes: reimbursement.notes,
    })
    .from(reimbursement)
    .where(
      and(
        eq(reimbursement.organizationId, orgId),
        eq(reimbursement.expenseTxId, expenseTxId),
      ),
    )
    .limit(1);
  return r ?? null;
}

export type ReimbursementStatusByTxId = Map<
  string,
  "pending" | "reimbursed"
>;

/**
 * Devolve um Map indexado pelo expense_tx_id com o status do reembolso.
 * Usado para renderizar badge na listagem de lançamentos.
 */
export async function reimbursementStatusByExpenseIds(
  orgId: string,
  expenseTxIds: string[],
): Promise<ReimbursementStatusByTxId> {
  const result: ReimbursementStatusByTxId = new Map();
  if (expenseTxIds.length === 0) return result;

  const rows = await db
    .select({
      expenseTxId: reimbursement.expenseTxId,
      incomeTxId: reimbursement.incomeTxId,
    })
    .from(reimbursement)
    .where(
      and(
        eq(reimbursement.organizationId, orgId),
        sql`${reimbursement.expenseTxId} = ANY(${expenseTxIds}::uuid[])`,
      ),
    );
  for (const r of rows) {
    result.set(r.expenseTxId, r.incomeTxId ? "reimbursed" : "pending");
  }
  return result;
}
