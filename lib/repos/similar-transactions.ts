import "server-only";

import { and, desc, eq, gte, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { category, financialAccount, transaction } from "@/db/schema/finance";
import {
  DESCRIPTION_NORMALIZE_SQL,
  normalizeDescription,
} from "./category-suggestions";

const LOOKBACK_DAYS = 365;
const MAX_RESULTS = 100;

export type SimilarTransaction = {
  id: string;
  description: string;
  cleanDescription: string | null;
  amount: string;
  kind: "income" | "expense";
  occurredOn: string;
  accountId: string | null;
  accountName: string | null;
  accountColor: string | null;
  currentCategoryId: string | null;
  currentCategoryName: string | null;
};

export type SimilarLookup = {
  reference: {
    id: string;
    description: string;
    cleanDescription: string | null;
    kind: "income" | "expense";
    categoryId: string;
    categoryName: string;
    categoryColor: string | null;
  } | null;
  items: SimilarTransaction[];
};

/**
 * Procura lançamentos que tenham a mesma descrição normalizada da referência e
 * estejam SEM categoria — candidatos a herdar a categoria que o user acabou
 * de definir. Filtra transferências, parcelas-filhas e splits-filhos.
 */
export async function findSimilarUncategorizedTransactions(
  orgId: string,
  referenceTxId: string,
): Promise<SimilarLookup> {
  const [ref] = await db
    .select({
      id: transaction.id,
      description: transaction.description,
      cleanDescription: transaction.cleanDescription,
      kind: transaction.kind,
      categoryId: transaction.categoryId,
      categoryName: category.name,
      categoryColor: category.color,
    })
    .from(transaction)
    .leftJoin(category, eq(transaction.categoryId, category.id))
    .where(
      and(
        eq(transaction.id, referenceTxId),
        eq(transaction.organizationId, orgId),
      ),
    )
    .limit(1);

  if (!ref || !ref.categoryId || !ref.categoryName) {
    return { reference: null, items: [] };
  }
  if (ref.kind !== "income" && ref.kind !== "expense") {
    return { reference: null, items: [] };
  }

  const target = (ref.cleanDescription?.trim() || ref.description).trim();
  const normTarget = normalizeDescription(target);
  if (!normTarget) {
    return {
      reference: {
        id: ref.id,
        description: ref.description,
        cleanDescription: ref.cleanDescription,
        kind: ref.kind,
        categoryId: ref.categoryId,
        categoryName: ref.categoryName,
        categoryColor: ref.categoryColor,
      },
      items: [],
    };
  }

  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);
  const sinceISO = since.toISOString().slice(0, 10);

  const rows = await db
    .select({
      id: transaction.id,
      description: transaction.description,
      cleanDescription: transaction.cleanDescription,
      amount: transaction.amount,
      kind: transaction.kind,
      occurredOn: transaction.occurredOn,
      accountId: transaction.accountId,
      accountName: financialAccount.name,
      accountColor: financialAccount.color,
    })
    .from(transaction)
    .leftJoin(financialAccount, eq(transaction.accountId, financialAccount.id))
    .where(
      and(
        eq(transaction.organizationId, orgId),
        eq(transaction.kind, ref.kind),
        isNull(transaction.categoryId),
        isNull(transaction.transferToAccountId),
        isNull(transaction.parentTransactionId),
        isNull(transaction.paidInvoiceId),
        ne(transaction.id, referenceTxId),
        gte(transaction.occurredOn, sinceISO),
        sql`${DESCRIPTION_NORMALIZE_SQL} = ${normTarget}`,
      ),
    )
    .orderBy(desc(transaction.occurredOn))
    .limit(MAX_RESULTS);

  const items: SimilarTransaction[] = rows.map((r) => ({
    id: r.id,
    description: r.description,
    cleanDescription: r.cleanDescription,
    amount: r.amount,
    kind: r.kind as "income" | "expense",
    occurredOn: r.occurredOn,
    accountId: r.accountId,
    accountName: r.accountName,
    accountColor: r.accountColor,
    currentCategoryId: null,
    currentCategoryName: null,
  }));

  return {
    reference: {
      id: ref.id,
      description: ref.description,
      cleanDescription: ref.cleanDescription,
      kind: ref.kind,
      categoryId: ref.categoryId,
      categoryName: ref.categoryName,
      categoryColor: ref.categoryColor,
    },
    items,
  };
}
