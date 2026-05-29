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
  /** Status do reembolso desta despesa, lido direto de transaction.reimbursable_status. */
  reimbursableStatus: "none" | "pending" | "received";
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

// `hideReimbursable` foi removido. Reembolso agora é tratado pelo modelo
// "soma natural da categoria": lança o gasto numa categoria reembolsável,
// lança o recebimento na MESMA categoria, e o net (= expense - income)
// reflete o saldo pendente. Sem filtro, sem mecanismo de vínculo silencioso.

function buildOrderBy(
  sort: { col: "date" | "description" | "category" | "amount"; dir: "asc" | "desc" } | undefined,
  dateCol: ReturnType<typeof dateForView>,
) {
  const dirFn = sort?.dir === "asc" ? asc : desc;
  const orderBy: Array<ReturnType<typeof asc> | ReturnType<typeof desc>> = [];
  if (sort) {
    if (sort.col === "date") {
      orderBy.push(dirFn(dateCol));
    } else if (sort.col === "description") {
      orderBy.push(
        dirFn(sql`COALESCE(${transaction.cleanDescription}, ${transaction.description})`),
      );
    } else if (sort.col === "category") {
      orderBy.push(dirFn(sql`COALESCE(${category.name}, '')`));
    } else if (sort.col === "amount") {
      orderBy.push(dirFn(sql`${transaction.amount}::numeric`));
    }
  }
  // Fallback secundário pra estabilidade
  orderBy.push(desc(dateCol));
  orderBy.push(desc(transaction.createdAt));
  return orderBy;
}

export type TransactionSortCol =
  | "date"
  | "description"
  | "category"
  | "amount";

export async function listTransactions(
  orgId: string,
  filters: TransactionFilters = {},
  options: {
    view?: ViewMode;
    sort?: { col: TransactionSortCol; dir: "asc" | "desc" };
  } = {},
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
    where.push(
      // Inclui subcategorias quando o id filtrado é uma categoria-mãe.
      sql`(${transaction.categoryId} = ${filters.categoryId}
        OR ${transaction.categoryId} IN (
          SELECT id FROM ${category} WHERE parent_id = ${filters.categoryId}
        ))`,
    );
  if (filters.kind) where.push(eq(transaction.kind, filters.kind));

  const splitCountSubquery = sql<number>`(
    SELECT COUNT(*)::int FROM ${transaction} child
    WHERE child.parent_transaction_id = ${transaction.id}
  )`.as("split_count");

  const isReversedSubquery = sql<boolean>`EXISTS (
    SELECT 1 FROM ${transaction} rev
    WHERE rev.reverses_transaction_id = ${transaction.id}
  )`.as("is_reversed");

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
      reimbursableStatus: transaction.reimbursableStatus,
      pendingStatus: transaction.pendingStatus,
      reversesTransactionId: transaction.reversesTransactionId,
      isReversed: isReversedSubquery,
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
    .orderBy(...buildOrderBy(options.sort, dateCol));

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
    reimbursableStatus: r.reimbursableStatus,
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
  // Mapeia posição original de cada linha pra preservar a ordem do SQL.
  // Quando uma parcela é agregada num grupo, o agregado herda a posição da
  // primeira parcela (a com installmentNumber=1, normalmente).
  const positions = new Map<string, number>();
  rows.forEach((r, idx) => positions.set(r.id, idx));

  const groups = new Map<string, TransactionRow[]>();
  const out: TransactionRow[] = [];
  const aggregatedPositions = new Map<string, number>();

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

    const aggregatedRow: TransactionRow = {
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
    };
    // Posição do agregado = menor posição entre as parcelas originais
    let minPos = Infinity;
    for (const p of parcels) {
      const pos = positions.get(p.id);
      if (pos !== undefined && pos < minPos) minPos = pos;
    }
    aggregatedPositions.set(aggregatedRow.id, minPos);
    out.push(aggregatedRow);
  }

  // Reordena conforme a ordem original do SQL (preserva o sort solicitado).
  out.sort((a, b) => {
    const posA = positions.get(a.id) ?? aggregatedPositions.get(a.id) ?? 0;
    const posB = positions.get(b.id) ?? aggregatedPositions.get(b.id) ?? 0;
    return posA - posB;
  });
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
    where.push(
      // Inclui subcategorias quando o id filtrado é uma categoria-mãe.
      sql`(${transaction.categoryId} = ${filters.categoryId}
        OR ${transaction.categoryId} IN (
          SELECT id FROM ${category} WHERE parent_id = ${filters.categoryId}
        ))`,
    );
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

  // Estornos: quando a transação reverte outra, herda a categoria da original
  // (em vez de criar bucket separado). O sinal vem da regra geral abaixo.
  const reversed = alias(transaction, "reversed_tx");
  const effectiveCategoryId = sql<string | null>`COALESCE(${reversed.categoryId}, ${transaction.categoryId})`;
  // Bucket = categoria.kind quando há categoria; senão = kind da transação.
  // Isso garante que income lançado em categoria expense (ex.: reembolso na
  // mesma categoria da compra) ABATA a despesa em vez de virar receita solta.
  // Cast pra text porque category_kind e transaction_kind são enums distintos.
  const effectiveKind = sql<string>`COALESCE(${category.kind}::text, ${transaction.kind}::text)`;
  // Sinal: + quando o kind da tx bate com o kind do bucket; − quando é o oposto
  // (essa é a regra que faz o reembolso/estorno cancelar a despesa original).
  const signedAmount = sql<string>`
    CASE
      WHEN ${category.kind} IS NULL THEN ${transaction.amount}
      WHEN ${transaction.kind}::text = ${category.kind}::text THEN ${transaction.amount}
      ELSE -${transaction.amount}
    END
  `;

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
