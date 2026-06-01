import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { category, categoryBudget, transaction } from "@/db/schema/finance";

export type EffectiveBudget = {
  categoryId: string;
  /** Valor em reais como string com 2 casas. "0" se nada configurado. */
  amount: string;
  /** "default" quando vem do default da categoria, "month" quando é override. */
  source: "default" | "month" | "none";
};

/**
 * Para um mês YYYY-MM, retorna o budget efetivo de cada categoria da org.
 * Regra: override do mês > default da categoria > 0.
 */
export async function budgetsForMonth(
  orgId: string,
  month: string,
): Promise<Map<string, EffectiveBudget>> {
  const rows = await db
    .select({
      categoryId: categoryBudget.categoryId,
      month: categoryBudget.month,
      amountCents: categoryBudget.amountCents,
    })
    .from(categoryBudget)
    .where(eq(categoryBudget.organizationId, orgId));

  const byCategory = new Map<string, EffectiveBudget>();
  // Primeiro insere os defaults; overrides do mês sobrescrevem depois.
  for (const r of rows) {
    if (r.month !== null) continue;
    byCategory.set(r.categoryId, {
      categoryId: r.categoryId,
      amount: (r.amountCents / 100).toFixed(2),
      source: "default",
    });
  }
  for (const r of rows) {
    if (r.month !== month) continue;
    byCategory.set(r.categoryId, {
      categoryId: r.categoryId,
      amount: (r.amountCents / 100).toFixed(2),
      source: "month",
    });
  }
  return byCategory;
}

/**
 * Upsert de budget. month=null grava default; month="YYYY-MM" grava override.
 * Passar amount="0" e force=false remove o registro.
 */
export async function setBudget(
  orgId: string,
  categoryId: string,
  month: string | null,
  amountCents: number,
): Promise<void> {
  // Verifica se existe pra escolher INSERT ou UPDATE (índice parcial não
  // se presta a ON CONFLICT direto sem target específico).
  const existing = await db
    .select({ id: categoryBudget.id })
    .from(categoryBudget)
    .where(
      and(
        eq(categoryBudget.organizationId, orgId),
        eq(categoryBudget.categoryId, categoryId),
        month === null
          ? isNull(categoryBudget.month)
          : eq(categoryBudget.month, month),
      ),
    )
    .limit(1);

  if (amountCents === 0) {
    if (existing[0]) {
      await db
        .delete(categoryBudget)
        .where(eq(categoryBudget.id, existing[0].id));
    }
    return;
  }

  if (existing[0]) {
    await db
      .update(categoryBudget)
      .set({ amountCents, updatedAt: new Date() })
      .where(eq(categoryBudget.id, existing[0].id));
  } else {
    await db.insert(categoryBudget).values({
      organizationId: orgId,
      categoryId,
      month,
      amountCents,
    });
  }
}

/**
 * Histórico de gasto efetivo por categoria nos últimos N meses (excluindo o
 * mês atual). Retorna média, min, max e quantidade de meses com gasto > 0,
 * pra alimentar sugestão automática de orçamento.
 */
export async function spendingStatsByCategory(
  orgId: string,
  options: { monthsBack?: number; ownerId?: string } = {},
): Promise<Map<string, { avgCents: number; minCents: number; maxCents: number; samples: number }>> {
  const monthsBack = options.monthsBack ?? 6;
  // Calcula janela [from, to) em SP TZ via JS.
  const { todayParts } = await import("@/lib/format");
  const { year, month } = todayParts();
  const total = year * 12 + (month - 1);
  const startTotal = total - monthsBack;
  const startY = Math.floor(startTotal / 12);
  const startM = (startTotal % 12) + 1;
  const from = `${startY}-${String(startM).padStart(2, "0")}-01`;
  // 'to' = primeiro dia do mês atual (exclusivo via < )
  const to = `${year}-${String(month).padStart(2, "0")}-01`;

  type Row = {
    category_id: string | null;
    month: string;
    total: string;
  };
  const ownerFilter = options.ownerId
    ? sql`AND t.owner_id = ${options.ownerId}`
    : sql``;
  const rows = await db.execute<Row>(sql`
    SELECT
      t.category_id,
      TO_CHAR(COALESCE(t.purchase_date, t.occurred_on), 'YYYY-MM') as month,
      SUM(t.amount)::text as total
    FROM ${transaction} t
    WHERE t.organization_id = ${orgId}
      AND t.kind = 'expense'
      AND t.parent_transaction_id IS NULL
      AND t.paid_invoice_id IS NULL
      AND COALESCE(t.purchase_date, t.occurred_on) >= ${from}
      AND COALESCE(t.purchase_date, t.occurred_on) < ${to}
      ${ownerFilter}
    GROUP BY t.category_id, TO_CHAR(COALESCE(t.purchase_date, t.occurred_on), 'YYYY-MM')
  `);

  // Agrupa por categoria, calcula stats sobre as amostras (meses) onde há
  // gasto. Mesmo se a categoria não apareceu em algum mês, contamos só os
  // meses onde teve gasto (samples).
  const byCategory = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.category_id) continue;
    const cents = Math.round(Number(r.total) * 100);
    if (!Number.isFinite(cents) || cents <= 0) continue;
    const arr = byCategory.get(r.category_id) ?? [];
    arr.push(cents);
    byCategory.set(r.category_id, arr);
  }

  const out = new Map<
    string,
    { avgCents: number; minCents: number; maxCents: number; samples: number }
  >();
  for (const [catId, values] of byCategory) {
    if (values.length === 0) continue;
    const sum = values.reduce((a, b) => a + b, 0);
    out.set(catId, {
      avgCents: Math.round(sum / values.length),
      minCents: Math.min(...values),
      maxCents: Math.max(...values),
      samples: values.length,
    });
  }
  return out;
}

/**
 * Despesa realizada por categoria num mês (YYYY-MM). Reaproveita a lógica de
 * /relatorios mas escopada a expenses pra uso em /orcamento.
 */
export async function spendingByMonth(
  orgId: string,
  month: string,
  options: { ownerId?: string } = {},
): Promise<Map<string, string>> {
  const ownerFilter = options.ownerId
    ? sql`AND t.owner_id = ${options.ownerId}`
    : sql``;
  type Row = { category_id: string | null; total: string };
  const rows = await db.execute<Row>(sql`
    SELECT
      t.category_id,
      SUM(t.amount)::text as total
    FROM ${transaction} t
    WHERE t.organization_id = ${orgId}
      AND t.kind = 'expense'
      AND t.parent_transaction_id IS NULL
      AND t.paid_invoice_id IS NULL
      AND TO_CHAR(COALESCE(t.purchase_date, t.occurred_on), 'YYYY-MM') = ${month}
      ${ownerFilter}
    GROUP BY t.category_id
  `);
  const map = new Map<string, string>();
  for (const r of rows) {
    if (!r.category_id) continue;
    map.set(r.category_id, r.total);
  }
  return map;
}

/** Categorias da org (renormaliza pra usar com budgets/spending). */
export async function categoriesForBudget(
  orgId: string,
): Promise<
  Array<{
    id: string;
    name: string;
    color: string | null;
    parentId: string | null;
    archived: boolean;
    includeInReports: boolean;
    kind: "income" | "expense";
  }>
> {
  const rows = await db
    .select({
      id: category.id,
      name: category.name,
      color: category.color,
      parentId: category.parentId,
      archived: category.archived,
      includeInReports: category.includeInReports,
      kind: category.kind,
      isTransfer: category.isTransfer,
    })
    .from(category)
    .where(eq(category.organizationId, orgId));
  return rows
    .filter((r) => !r.isTransfer)
    .map(({ isTransfer: _isTransfer, ...rest }) => rest);
}
