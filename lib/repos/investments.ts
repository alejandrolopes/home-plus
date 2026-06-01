import "server-only";

import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  financialAccount,
  investment,
  investmentSnapshot,
  transaction,
} from "@/db/schema/finance";

export type InvestmentRow = typeof investment.$inferSelect;
export type SnapshotRow = typeof investmentSnapshot.$inferSelect;

export type InvestmentWithSnapshots = InvestmentRow & {
  snapshots: SnapshotRow[];
  /** Saldo do mês mais recente; 0 se nenhum snapshot. */
  currentBalanceCents: number;
  /** Total aplicado histórico (soma de appliedCents). */
  totalAppliedCents: number;
  /** Rendimento do snapshot mais recente vs anterior; null se < 2 snapshots. */
  lastMonthReturnCents: number | null;
};

function withDerivatives(
  row: InvestmentRow,
  snapshots: SnapshotRow[],
): InvestmentWithSnapshots {
  // snapshots vêm em ordem desc; pega o último (mais recente) e o anterior
  const last = snapshots[0];
  const prev = snapshots[1];
  const currentBalanceCents = last?.balanceCents ?? 0;
  const totalAppliedCents = snapshots.reduce(
    (sum, s) => sum + s.appliedCents,
    0,
  );
  let lastMonthReturnCents: number | null = null;
  if (last && prev) {
    lastMonthReturnCents =
      last.balanceCents - prev.balanceCents - last.appliedCents;
  }
  return {
    ...row,
    snapshots,
    currentBalanceCents,
    totalAppliedCents,
    lastMonthReturnCents,
  };
}

/**
 * Lista investimentos visíveis ao usuário (família + pessoais do próprio),
 * cada um com seus snapshots ordenados do mais recente pro mais antigo.
 */
export async function listInvestments(
  orgId: string,
  userId: string,
  options: { includeArchived?: boolean } = {},
): Promise<InvestmentWithSnapshots[]> {
  const where = [
    eq(investment.organizationId, orgId),
    or(isNull(investment.ownerId), eq(investment.ownerId, userId))!,
  ];
  if (!options.includeArchived) {
    where.push(eq(investment.archived, false));
  }
  const rows = await db
    .select()
    .from(investment)
    .where(and(...where))
    .orderBy(asc(investment.productName));
  if (rows.length === 0) return [];

  const snaps = await db
    .select()
    .from(investmentSnapshot)
    .where(eq(investmentSnapshot.organizationId, orgId))
    .orderBy(desc(investmentSnapshot.month));

  const byInvestment = new Map<string, SnapshotRow[]>();
  for (const s of snaps) {
    const arr = byInvestment.get(s.investmentId) ?? [];
    arr.push(s);
    byInvestment.set(s.investmentId, arr);
  }
  return rows.map((r) => withDerivatives(r, byInvestment.get(r.id) ?? []));
}

export async function getInvestment(
  orgId: string,
  id: string,
): Promise<InvestmentWithSnapshots | null> {
  const [row] = await db
    .select()
    .from(investment)
    .where(and(eq(investment.id, id), eq(investment.organizationId, orgId)))
    .limit(1);
  if (!row) return null;
  const snaps = await db
    .select()
    .from(investmentSnapshot)
    .where(eq(investmentSnapshot.investmentId, id))
    .orderBy(desc(investmentSnapshot.month));
  return withDerivatives(row, snaps);
}

export type InvestmentTotals = {
  totalBalanceCents: number;
  totalAppliedCents: number;
  /** Rendimento bruto = totalBalance - totalApplied (lifetime). */
  lifetimeReturnCents: number;
  /** Rendimento do mês mais recente, somando todos. */
  lastMonthReturnCents: number;
  byClass: { fixed_income: number; variable_income: number };
  byInstitution: Map<string, number>;
};

/**
 * Grau de Independência Financeira = rendimento médio mensal / despesa média
 * mensal. 100% = a carteira sozinha já cobre o gasto típico do usuário.
 *
 * Janela: últimos N meses (default 6). Considera apenas meses com snapshot
 * encadeado (precisa do mês anterior pra calcular rendimento).
 */
export type FinancialIndependence = {
  /** Em [0, ∞), onde 1 = 100%. */
  ratio: number;
  avgMonthlyReturnCents: number;
  avgMonthlyExpenseCents: number;
  samplesReturn: number;
  samplesExpense: number;
};

export async function computeFinancialIndependence(
  orgId: string,
  userId: string,
  options: { monthsBack?: number } = {},
): Promise<FinancialIndependence> {
  const monthsBack = options.monthsBack ?? 6;

  // 1) Rendimento mensal agregado (soma de todos investimentos visíveis ao
  // usuário). Pra cada investimento, pega snapshots em ordem cronológica
  // crescente, calcula rendimento[m] = balance[m] - balance[m-1] - applied[m].
  const investments = await listInvestments(orgId, userId);
  const returnsByMonth = new Map<string, number>();
  for (const inv of investments) {
    // snapshots vêm desc; pra calcular precisamos ordem cronológica
    const snaps = [...inv.snapshots].reverse();
    for (let i = 1; i < snaps.length; i++) {
      const cur = snaps[i];
      const prev = snaps[i - 1];
      const ret = cur.balanceCents - prev.balanceCents - cur.appliedCents;
      returnsByMonth.set(
        cur.month,
        (returnsByMonth.get(cur.month) ?? 0) + ret,
      );
    }
  }
  // Considera apenas os últimos `monthsBack` meses com rendimento computável
  const sortedReturnMonths = Array.from(returnsByMonth.keys()).sort().reverse();
  const recentReturns = sortedReturnMonths
    .slice(0, monthsBack)
    .map((m) => returnsByMonth.get(m)!);
  const totalReturn = recentReturns.reduce((a, b) => a + b, 0);
  const avgMonthlyReturnCents =
    recentReturns.length > 0
      ? Math.round(totalReturn / recentReturns.length)
      : 0;

  // 2) Despesa mensal média (últimos `monthsBack` meses completos), reusa a
  // mesma lógica de filtros do /relatorios: kind expense, sem split-child,
  // sem paid_invoice_id (pra evitar double-count com a fatura), e exclui
  // mesma-conta-transfer (hideSameOwnerTransfer).
  type Row = { month: string; total: string };
  const rows = await db.execute<Row>(sql`
    SELECT
      TO_CHAR(COALESCE(t.purchase_date, t.occurred_on), 'YYYY-MM') as month,
      SUM(t.amount)::text as total
    FROM ${transaction} t
    WHERE t.organization_id = ${orgId}
      AND t.owner_id = ${userId}
      AND t.kind = 'expense'
      AND t.parent_transaction_id IS NULL
      AND t.paid_invoice_id IS NULL
      AND (
        t.transfer_to_account_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM ${financialAccount} dest
          WHERE dest.id = t.transfer_to_account_id
            AND dest.owner_id = t.owner_id
        )
      )
    GROUP BY TO_CHAR(COALESCE(t.purchase_date, t.occurred_on), 'YYYY-MM')
    ORDER BY month DESC
    LIMIT ${monthsBack}
  `);
  const totalExpenseCents = rows.reduce(
    (sum, r) => sum + Math.round(Number(r.total) * 100),
    0,
  );
  const avgMonthlyExpenseCents =
    rows.length > 0 ? Math.round(totalExpenseCents / rows.length) : 0;

  const ratio =
    avgMonthlyExpenseCents > 0
      ? avgMonthlyReturnCents / avgMonthlyExpenseCents
      : 0;

  return {
    ratio,
    avgMonthlyReturnCents,
    avgMonthlyExpenseCents,
    samplesReturn: recentReturns.length,
    samplesExpense: rows.length,
  };
}

export function computeTotals(
  investments: InvestmentWithSnapshots[],
): InvestmentTotals {
  let totalBalanceCents = 0;
  let totalAppliedCents = 0;
  let lastMonthReturnCents = 0;
  const byClass = { fixed_income: 0, variable_income: 0 };
  const byInstitution = new Map<string, number>();
  for (const inv of investments) {
    totalBalanceCents += inv.currentBalanceCents;
    totalAppliedCents += inv.totalAppliedCents;
    if (inv.lastMonthReturnCents !== null) {
      lastMonthReturnCents += inv.lastMonthReturnCents;
    }
    if (inv.class === "fixed_income") {
      byClass.fixed_income += inv.currentBalanceCents;
    } else {
      byClass.variable_income += inv.currentBalanceCents;
    }
    byInstitution.set(
      inv.institution,
      (byInstitution.get(inv.institution) ?? 0) + inv.currentBalanceCents,
    );
  }
  return {
    totalBalanceCents,
    totalAppliedCents,
    lifetimeReturnCents: totalBalanceCents - totalAppliedCents,
    lastMonthReturnCents,
    byClass,
    byInstitution,
  };
}
