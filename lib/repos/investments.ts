import "server-only";

import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { investment, investmentSnapshot } from "@/db/schema/finance";

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
