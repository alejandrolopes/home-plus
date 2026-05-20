import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  category,
  creditCardInvoice,
  financialAccount,
  reimbursement,
  transaction,
} from "@/db/schema/finance";
import type { ViewMode } from "@/lib/preferences";

export type TransactionRow = {
  id: string;
  occurredOn: string;
  purchaseDate: string | null;
  displayDate: string;
  description: string;
  cleanDescription: string | null;
  paymentMethod: string | null;
  counterpartyName: string | null;
  counterpartyDocument: string | null;
  counterpartyBank: string | null;
  counterpartyBranch: string | null;
  counterpartyAccount: string | null;
  amount: string;
  kind: "income" | "expense" | "transfer";
  notes: string | null;
  ownerId: string;
  paidInvoiceId: string | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
  installmentGroupId: string | null;
  account: {
    id: string;
    name: string;
    type: string;
    color: string | null;
  } | null;
  category: { id: string; name: string; color: string | null } | null;
  creditCardInvoiceId: string | null;
  invoiceStatus: string | null;
  isPending: boolean;
  settledAt: Date | null;
  splitCount: number;
  isTransfer: boolean;
  isTithable: boolean;
  pendingTransferStatus: "pending" | null;
  transferToAccountId: string | null;
  /** Esta transação estorna outra (income vinculado a uma expense original) */
  reversesTransactionId: string | null;
  /** Outra transação aponta para esta como estorno (expense original já estornada) */
  isReversed: boolean;
  /** Status do reembolso desta despesa, quando aplicável. */
  reimbursementStatus: "pending" | "reimbursed" | null;
  aggregated?: {
    ids: string[];
    installmentCount: number;
    pendingCount: number;
    perInstallmentAmount: string;
  };
};

export type SplitChild = {
  id: string;
  amount: string;
  kind: "income" | "expense";
  description: string | null;
  isTithable: boolean;
  category: { id: string; name: string; color: string | null } | null;
};

export type TransactionFilters = {
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string;
  kind?: "income" | "expense";
  ownerId?: string;
};

function dateForView(view: ViewMode) {
  return view === "purchase"
    ? sql<string>`COALESCE(${transaction.purchaseDate}, ${transaction.occurredOn})`
    : sql<string>`${transaction.occurredOn}`;
}

// Esconde transferências apenas quando ambas as pernas pertencem ao mesmo dono
// (movem dinheiro entre contas do próprio usuário e se anulam). Transferências
// entre membros da família continuam visíveis para cada lado, pois cada perna
// representa um movimento real no extrato do respectivo dono.
function hideSameOwnerTransfer() {
  return or(
    isNull(transaction.transferToAccountId),
    sql`NOT EXISTS (
      SELECT 1 FROM ${financialAccount} dest
      WHERE dest.id = ${transaction.transferToAccountId}
        AND dest.owner_id = ${transaction.ownerId}
    )`,
  )!;
}

// Exclui lançamentos cuja categoria seja marcada como reembolsável. Usado nos
// totais de relatórios — esses lançamentos aparecem em /reembolsos.
function hideReimbursable() {
  return sql`NOT EXISTS (
    SELECT 1 FROM ${category} cat_r
    WHERE cat_r.id = ${transaction.categoryId}
      AND cat_r.is_reimbursable = true
  )`;
}

export async function listTransactions(
  orgId: string,
  filters: TransactionFilters = {},
  options: { view?: ViewMode } = {},
): Promise<TransactionRow[]> {
  const view = options.view ?? "purchase";
  const dateCol = dateForView(view);

  const where = [
    eq(transaction.organizationId, orgId),
    isNull(transaction.parentTransactionId),
  ];
  if (filters.ownerId) where.push(eq(transaction.ownerId, filters.ownerId));
  if (filters.from) where.push(gte(dateCol, filters.from));
  if (filters.to) where.push(lte(dateCol, filters.to));
  if (filters.accountId) {
    // Filtro por conta: mostra inclusive transferências envolvendo a conta.
    where.push(eq(transaction.accountId, filters.accountId));
  } else {
    // Visão geral: esconde só transferências entre contas do mesmo dono.
    where.push(hideSameOwnerTransfer());
  }
  if (filters.categoryId)
    where.push(eq(transaction.categoryId, filters.categoryId));
  if (filters.kind) where.push(eq(transaction.kind, filters.kind));

  const splitCountSubquery = sql<number>`(
    SELECT COUNT(*)::int FROM ${transaction} child
    WHERE child.parent_transaction_id = ${transaction.id}
  )`.as("split_count");

  const isReversedSubquery = sql<boolean>`EXISTS (
    SELECT 1 FROM ${transaction} rev
    WHERE rev.reverses_transaction_id = ${transaction.id}
  )`.as("is_reversed");

  const reimbursementStatusSubquery = sql<string | null>`(
    SELECT CASE WHEN ${reimbursement.incomeTxId} IS NULL THEN 'pending' ELSE 'reimbursed' END
    FROM ${reimbursement}
    WHERE ${reimbursement.expenseTxId} = ${transaction.id}
    LIMIT 1
  )`.as("reimbursement_status");

  const rows = await db
    .select({
      id: transaction.id,
      occurredOn: transaction.occurredOn,
      purchaseDate: transaction.purchaseDate,
      displayDate: dateCol.as("display_date"),
      description: transaction.description,
      amount: transaction.amount,
      kind: transaction.kind,
      notes: transaction.notes,
      ownerId: transaction.ownerId,
      paidInvoiceId: transaction.paidInvoiceId,
      installmentNumber: transaction.installmentNumber,
      installmentTotal: transaction.installmentTotal,
      installmentGroupId: transaction.installmentGroupId,
      creditCardInvoiceId: transaction.creditCardInvoiceId,
      settledAt: transaction.settledAt,
      cleanDescription: transaction.cleanDescription,
      paymentMethod: transaction.paymentMethod,
      counterpartyName: transaction.counterpartyName,
      counterpartyDocument: transaction.counterpartyDocument,
      counterpartyBank: transaction.counterpartyBank,
      counterpartyBranch: transaction.counterpartyBranch,
      counterpartyAccount: transaction.counterpartyAccount,
      accountId: financialAccount.id,
      accountName: financialAccount.name,
      accountType: financialAccount.type,
      accountColor: financialAccount.color,
      categoryId: category.id,
      categoryName: category.name,
      categoryColor: category.color,
      invoiceStatus: creditCardInvoice.status,
      transferToAccountId: transaction.transferToAccountId,
      externalPaymentId: transaction.externalPaymentId,
      isTithable: transaction.isTithable,
      pendingStatus: transaction.pendingStatus,
      reversesTransactionId: transaction.reversesTransactionId,
      isReversed: isReversedSubquery,
      reimbursementStatus: reimbursementStatusSubquery,
      splitCount: splitCountSubquery,
    })
    .from(transaction)
    .leftJoin(
      financialAccount,
      eq(transaction.accountId, financialAccount.id),
    )
    .leftJoin(category, eq(transaction.categoryId, category.id))
    .leftJoin(
      creditCardInvoice,
      eq(transaction.creditCardInvoiceId, creditCardInvoice.id),
    )
    .where(and(...where))
    .orderBy(desc(dateCol), desc(transaction.createdAt));

  const mapped: TransactionRow[] = rows.map((r) => ({
    id: r.id,
    occurredOn: r.occurredOn,
    purchaseDate: r.purchaseDate,
    displayDate: r.displayDate,
    description: r.description,
    cleanDescription: r.cleanDescription,
    paymentMethod: r.paymentMethod,
    counterpartyName: r.counterpartyName,
    counterpartyDocument: r.counterpartyDocument,
    counterpartyBank: r.counterpartyBank,
    counterpartyBranch: r.counterpartyBranch,
    counterpartyAccount: r.counterpartyAccount,
    amount: r.amount,
    kind: r.kind,
    notes: r.notes,
    ownerId: r.ownerId,
    paidInvoiceId: r.paidInvoiceId,
    installmentNumber: r.installmentNumber,
    installmentTotal: r.installmentTotal,
    installmentGroupId: r.installmentGroupId,
    creditCardInvoiceId: r.creditCardInvoiceId,
    invoiceStatus: r.invoiceStatus,
    settledAt: r.settledAt,
    splitCount: Number(r.splitCount ?? 0),
    isTransfer:
      !!r.transferToAccountId ||
      (r.externalPaymentId?.startsWith("transfer:") ?? false),
    isTithable: !!r.isTithable,
    pendingTransferStatus: r.pendingStatus ?? null,
    transferToAccountId: r.transferToAccountId,
    reversesTransactionId: r.reversesTransactionId ?? null,
    isReversed: !!r.isReversed,
    reimbursementStatus:
      r.reimbursementStatus === "pending"
        ? "pending"
        : r.reimbursementStatus === "reimbursed"
          ? "reimbursed"
          : null,
    isPending:
      !!r.creditCardInvoiceId &&
      r.invoiceStatus !== "paid" &&
      r.settledAt === null,
    account: r.accountId
      ? {
          id: r.accountId,
          name: r.accountName ?? "",
          type: r.accountType ?? "",
          color: r.accountColor,
        }
      : null,
    category: r.categoryId
      ? {
          id: r.categoryId,
          name: r.categoryName!,
          color: r.categoryColor,
        }
      : null,
  }));

  if (view === "purchase") {
    return aggregateInstallments(mapped);
  }
  return mapped;
}

export async function listSplitChildrenForParents(
  orgId: string,
  parentIds: string[],
): Promise<Map<string, SplitChild[]>> {
  const map = new Map<string, SplitChild[]>();
  if (parentIds.length === 0) return map;

  const rows = await db
    .select({
      id: transaction.id,
      parentId: transaction.parentTransactionId,
      amount: transaction.amount,
      kind: transaction.kind,
      description: transaction.description,
      isTithable: transaction.isTithable,
      categoryId: category.id,
      categoryName: category.name,
      categoryColor: category.color,
    })
    .from(transaction)
    .leftJoin(category, eq(transaction.categoryId, category.id))
    .where(
      and(
        eq(transaction.organizationId, orgId),
        inArray(transaction.parentTransactionId, parentIds),
      ),
    )
    .orderBy(asc(transaction.createdAt));

  for (const r of rows) {
    if (!r.parentId) continue;
    const child: SplitChild = {
      id: r.id,
      amount: r.amount,
      kind:
        r.kind === "transfer" ? "expense" : (r.kind as "income" | "expense"),
      description: r.description,
      isTithable: !!r.isTithable,
      category: r.categoryId
        ? {
            id: r.categoryId,
            name: r.categoryName!,
            color: r.categoryColor,
          }
        : null,
    };
    const existing = map.get(r.parentId);
    if (existing) existing.push(child);
    else map.set(r.parentId, [child]);
  }
  return map;
}

export async function listSplitChildren(
  orgId: string,
  parentId: string,
): Promise<SplitChild[]> {
  const rows = await db
    .select({
      id: transaction.id,
      amount: transaction.amount,
      kind: transaction.kind,
      description: transaction.description,
      isTithable: transaction.isTithable,
      categoryId: category.id,
      categoryName: category.name,
      categoryColor: category.color,
    })
    .from(transaction)
    .leftJoin(category, eq(transaction.categoryId, category.id))
    .where(
      and(
        eq(transaction.organizationId, orgId),
        eq(transaction.parentTransactionId, parentId),
      ),
    )
    .orderBy(asc(transaction.createdAt));

  return rows.map((r) => ({
    id: r.id,
    amount: r.amount,
    kind: r.kind === "transfer" ? "expense" : (r.kind as "income" | "expense"),
    description: r.description,
    isTithable: !!r.isTithable,
    category: r.categoryId
      ? {
          id: r.categoryId,
          name: r.categoryName!,
          color: r.categoryColor,
        }
      : null,
  }));
}

function aggregateInstallments(rows: TransactionRow[]): TransactionRow[] {
  const groups = new Map<string, TransactionRow[]>();
  const out: TransactionRow[] = [];

  for (const r of rows) {
    if (r.installmentGroupId && r.installmentTotal && r.installmentTotal > 1) {
      const list = groups.get(r.installmentGroupId);
      if (list) list.push(r);
      else groups.set(r.installmentGroupId, [r]);
    } else {
      out.push(r);
    }
  }

  for (const parcels of groups.values()) {
    parcels.sort(
      (a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0),
    );
    const first = parcels[0];

    let totalCents = 0;
    for (const p of parcels) totalCents += Math.round(Number(p.amount) * 100);
    const total = (totalCents / 100).toFixed(2);

    const pendingCount = parcels.filter((p) => p.isPending).length;
    const baseDesc = first.description.replace(/\s*\(\d+\/\d+\)\s*$/, "");

    out.push({
      ...first,
      id: first.installmentGroupId!,
      description: baseDesc,
      amount: total,
      isPending: pendingCount > 0,
      aggregated: {
        ids: parcels.map((p) => p.id),
        installmentCount: first.installmentTotal ?? parcels.length,
        pendingCount,
        perInstallmentAmount: first.amount,
      },
    });
  }

  out.sort((a, b) => b.displayDate.localeCompare(a.displayDate));
  return out;
}

export async function summarizeMonth(orgId: string, from: string, to: string) {
  return summarizeRange(orgId, { from, to });
}

export async function summarizeRange(
  orgId: string,
  filters: TransactionFilters = {},
  options: { view?: ViewMode } = {},
) {
  const view = options.view ?? "purchase";
  const dateCol = dateForView(view);

  // KPIs de Receitas/Despesas refletem movimento de conta (parent-level).
  // Lógica anti-duplicação depende da view:
  //  - purchase: compras no cartão CONTAM (regime de competência).
  //    Pagamento da fatura NÃO conta (já contabilizado via compras).
  //  - invoice: pagamento da fatura CONTA (regime de caixa). Compras
  //    individuais no cartão NÃO contam (já agregadas pela fatura paga,
  //    ou pendentes via pendingCardSpend).
  const where = [
    eq(transaction.organizationId, orgId),
    isNull(transaction.parentTransactionId),
    hideReimbursable(),
  ];
  if (view === "purchase") {
    where.push(isNull(transaction.paidInvoiceId));
  } else {
    where.push(isNull(transaction.creditCardInvoiceId));
  }
  if (filters.ownerId) where.push(eq(transaction.ownerId, filters.ownerId));
  if (filters.from) where.push(gte(dateCol, filters.from));
  if (filters.to) where.push(lte(dateCol, filters.to));
  if (filters.accountId) {
    // Filtro por conta: transferências contam (entrada/saída real da conta).
    where.push(eq(transaction.accountId, filters.accountId));
  } else {
    // Visão geral: esconde só transferências entre contas do mesmo dono.
    where.push(hideSameOwnerTransfer());
  }
  if (filters.categoryId)
    where.push(eq(transaction.categoryId, filters.categoryId));
  if (filters.kind) where.push(eq(transaction.kind, filters.kind));

  const rows = await db
    .select({
      kind: transaction.kind,
      total: sql<string>`SUM(${transaction.amount})`,
    })
    .from(transaction)
    .where(and(...where))
    .groupBy(transaction.kind);

  const out = { income: "0", expense: "0" };
  for (const r of rows) {
    if (r.kind === "income") out.income = r.total ?? "0";
    if (r.kind === "expense") out.expense = r.total ?? "0";
  }
  return out;
}

export type CategoryTotalRow = {
  kind: "income" | "expense";
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  total: string;
};

export async function summarizeByCategory(
  orgId: string,
  filters: TransactionFilters = {},
  options: { view?: ViewMode } = {},
): Promise<CategoryTotalRow[]> {
  const view = options.view ?? "purchase";
  const dateCol = dateForView(view);

  const where = [
    eq(transaction.organizationId, orgId),
    inArray(transaction.kind, ["income", "expense"]),
    sql`NOT EXISTS (SELECT 1 FROM ${transaction} c WHERE c.parent_transaction_id = ${transaction.id})`,
    hideSameOwnerTransfer(),
    hideReimbursable(),
  ];
  if (view === "purchase") {
    where.push(isNull(transaction.paidInvoiceId));
  } else {
    where.push(isNull(transaction.creditCardInvoiceId));
  }
  if (filters.ownerId) where.push(eq(transaction.ownerId, filters.ownerId));
  if (filters.from) where.push(gte(dateCol, filters.from));
  if (filters.to) where.push(lte(dateCol, filters.to));
  if (filters.accountId)
    where.push(eq(transaction.accountId, filters.accountId));
  if (filters.kind) where.push(eq(transaction.kind, filters.kind));

  // Self-join: quando a transação é um estorno, atribuímos seu valor à
  // categoria/kind da transação ORIGINAL com sinal negativo, em vez de
  // criar um bucket separado. Resultado: a despesa original aparece já
  // descontada do reembolso.
  const reversed = alias(transaction, "reversed_tx");
  const effectiveKind = sql<string>`COALESCE(${reversed.kind}, ${transaction.kind})`;
  const effectiveCategoryId = sql<string | null>`COALESCE(${reversed.categoryId}, ${transaction.categoryId})`;
  const signedAmount = sql<string>`(CASE WHEN ${transaction.reversesTransactionId} IS NOT NULL THEN -1 ELSE 1 END) * ${transaction.amount}`;

  const rows = await db
    .select({
      kind: effectiveKind,
      categoryId: effectiveCategoryId,
      categoryName: category.name,
      categoryColor: category.color,
      total: sql<string>`COALESCE(SUM(${signedAmount}), 0)`,
    })
    .from(transaction)
    .leftJoin(reversed, eq(reversed.id, transaction.reversesTransactionId))
    .leftJoin(category, eq(category.id, effectiveCategoryId))
    .where(and(...where))
    .groupBy(effectiveKind, effectiveCategoryId, category.name, category.color);

  return rows.map((r) => ({
    kind: r.kind as "income" | "expense",
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    categoryColor: r.categoryColor,
    total: r.total,
  }));
}

export async function pendingCardSpend(
  orgId: string,
  filters: { from?: string; to?: string; ownerId?: string } = {},
  options: { view?: ViewMode } = {},
): Promise<string> {
  const view = options.view ?? "purchase";
  const dateCol = dateForView(view);

  const where = [
    eq(transaction.organizationId, orgId),
    eq(transaction.kind, "expense"),
    sql`${transaction.creditCardInvoiceId} IS NOT NULL`,
    isNull(transaction.settledAt),
    hideSameOwnerTransfer(),
    sql`NOT EXISTS (SELECT 1 FROM ${transaction} c WHERE c.parent_transaction_id = ${transaction.id})`,
    or(
      isNull(creditCardInvoice.status),
      ne(creditCardInvoice.status, "paid"),
    )!,
  ];
  if (filters.ownerId) where.push(eq(transaction.ownerId, filters.ownerId));
  if (filters.from) where.push(gte(dateCol, filters.from));
  if (filters.to) where.push(lte(dateCol, filters.to));

  const [row] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${transaction.amount}), 0)`,
    })
    .from(transaction)
    .leftJoin(
      creditCardInvoice,
      eq(transaction.creditCardInvoiceId, creditCardInvoice.id),
    )
    .where(and(...where));

  return row?.total ?? "0";
}

export async function totalBalance(
  orgId: string,
  options: { ownerId?: string } = {},
): Promise<string> {
  const accountWhere = [
    eq(financialAccount.organizationId, orgId),
    eq(financialAccount.archived, false),
    sql`${financialAccount.type} != 'credit_card'`,
  ];
  if (options.ownerId) {
    accountWhere.push(eq(financialAccount.ownerId, options.ownerId));
  }
  const [initialRow] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${financialAccount.initialBalance}), 0)`,
    })
    .from(financialAccount)
    .where(and(...accountWhere));

  const movementWhere = [
    eq(transaction.organizationId, orgId),
    sql`${financialAccount.type} != 'credit_card'`,
    isNull(transaction.parentTransactionId),
    hideSameOwnerTransfer(),
  ];
  if (options.ownerId) {
    movementWhere.push(eq(transaction.ownerId, options.ownerId));
  }

  const movementRows = await db
    .select({
      kind: transaction.kind,
      total: sql<string>`COALESCE(SUM(${transaction.amount}), 0)`,
    })
    .from(transaction)
    .innerJoin(
      financialAccount,
      eq(transaction.accountId, financialAccount.id),
    )
    .where(and(...movementWhere))
    .groupBy(transaction.kind);

  let totalCents = Math.round(Number(initialRow?.total ?? 0) * 100);
  for (const r of movementRows) {
    const cents = Math.round(Number(r.total) * 100);
    if (r.kind === "income") totalCents += cents;
    else if (r.kind === "expense") totalCents -= cents;
  }
  return (totalCents / 100).toFixed(2);
}
