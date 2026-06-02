import "server-only";

import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  financialAccount,
  investment,
  investmentSnapshot,
  plan,
  planContribution,
} from "@/db/schema/finance";
import { balancesByAccount } from "@/lib/repos/accounts";

export type PlanRow = typeof plan.$inferSelect;

export type PlanLinkedInfo = {
  /** "account" se vinculado a financial_account, "investment" se a investment,
   *  "manual" se sem vínculo (legado). */
  mode: "account" | "investment" | "manual";
  linkedAccountName?: string;
  linkedInvestmentName?: string;
};

export type PlanWithProgress = PlanRow &
  PlanLinkedInfo & {
    /** Saldo efetivo usado pra calcular progresso (vem do linked entity ou
     * fallback pro currentCents legado). */
    effectiveCurrentCents: number;
    /** Meses totais entre start e end (mínimo 1 pra evitar divisão por zero). */
    totalMonths: number;
    /** Meses entre start e hoje (cap a totalMonths). */
    monthsElapsed: number;
    /** target_cents / totalMonths. */
    monthlyTargetCents: number;
    /** monthlyTargetCents * monthsElapsed. O que "deveria" ter sido aportado. */
    expectedCents: number;
    /** target - current; cents. */
    remainingCents: number;
    /** current / target, em [0..1+]. */
    progress: number;
    /** "on_track" | "ahead" | "behind" | "completed". */
    status: "on_track" | "ahead" | "behind" | "completed";
  };

function diffMonths(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

function todayISO_SP(): string {
  // Reaproveita o helper TZ-aware
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

function computeProgress(
  row: PlanRow,
  linked: PlanLinkedInfo,
  effectiveCurrentCents: number,
): PlanWithProgress {
  const today = todayISO_SP();
  const totalMonths = Math.max(
    1,
    diffMonths(row.startDate, row.endDate),
  );
  const elapsed = Math.max(
    0,
    Math.min(totalMonths, diffMonths(row.startDate, today.slice(0, 7) + "-01")),
  );
  const monthlyTargetCents = Math.ceil(row.targetCents / totalMonths);
  const expectedCents = monthlyTargetCents * elapsed;
  const remainingCents = Math.max(0, row.targetCents - effectiveCurrentCents);
  const progress =
    row.targetCents > 0 ? effectiveCurrentCents / row.targetCents : 0;
  let status: PlanWithProgress["status"];
  if (effectiveCurrentCents >= row.targetCents) status = "completed";
  else if (effectiveCurrentCents >= expectedCents * 1.05) status = "ahead";
  else if (effectiveCurrentCents >= expectedCents * 0.9) status = "on_track";
  else status = "behind";
  return {
    ...row,
    ...linked,
    effectiveCurrentCents,
    totalMonths,
    monthsElapsed: elapsed,
    monthlyTargetCents,
    expectedCents,
    remainingCents,
    progress,
    status,
  };
}

/**
 * Para uma lista de planos, resolve o valor "current" e info do linked entity
 * usando saldo da conta (via balancesByAccount) ou último snapshot do
 * investimento. Faz uma única ida ao banco por tipo, eficiente.
 */
async function resolveLinkedProgress(
  orgId: string,
  rows: PlanRow[],
): Promise<Map<string, { linked: PlanLinkedInfo; current: number }>> {
  const result = new Map<
    string,
    { linked: PlanLinkedInfo; current: number }
  >();

  const accountIds = Array.from(
    new Set(
      rows
        .map((r) => r.linkedAccountId)
        .filter((v): v is string => v !== null),
    ),
  );
  const investmentIds = Array.from(
    new Set(
      rows
        .map((r) => r.linkedInvestmentId)
        .filter((v): v is string => v !== null),
    ),
  );

  const accountBalances = new Map<string, number>();
  const accountNames = new Map<string, string>();
  if (accountIds.length > 0) {
    const balances = await balancesByAccount(orgId);
    for (const [id, balStr] of balances)
      accountBalances.set(id, Math.round(Number(balStr) * 100));
    const accs = await db
      .select({ id: financialAccount.id, name: financialAccount.name })
      .from(financialAccount)
      .where(eq(financialAccount.organizationId, orgId));
    for (const a of accs) accountNames.set(a.id, a.name);
  }

  const investmentBalances = new Map<string, number>();
  const investmentNames = new Map<string, string>();
  if (investmentIds.length > 0) {
    const invs = await db
      .select({
        id: investment.id,
        productName: investment.productName,
      })
      .from(investment)
      .where(eq(investment.organizationId, orgId));
    for (const i of invs) investmentNames.set(i.id, i.productName);
    // Saldo mais recente: último snapshot de cada
    const snaps = await db
      .select({
        investmentId: investmentSnapshot.investmentId,
        month: investmentSnapshot.month,
        balanceCents: investmentSnapshot.balanceCents,
      })
      .from(investmentSnapshot)
      .where(eq(investmentSnapshot.organizationId, orgId))
      .orderBy(desc(investmentSnapshot.month));
    for (const s of snaps) {
      if (!investmentBalances.has(s.investmentId)) {
        investmentBalances.set(s.investmentId, s.balanceCents);
      }
    }
  }

  for (const row of rows) {
    if (row.linkedAccountId) {
      const current = accountBalances.get(row.linkedAccountId) ?? 0;
      const name = accountNames.get(row.linkedAccountId);
      result.set(row.id, {
        linked: { mode: "account", linkedAccountName: name },
        current,
      });
    } else if (row.linkedInvestmentId) {
      const current = investmentBalances.get(row.linkedInvestmentId) ?? 0;
      const name = investmentNames.get(row.linkedInvestmentId);
      result.set(row.id, {
        linked: { mode: "investment", linkedInvestmentName: name },
        current,
      });
    } else {
      result.set(row.id, {
        linked: { mode: "manual" },
        current: row.currentCents,
      });
    }
  }

  return result;
}

/**
 * Lista todos os planos visíveis para um usuário: planos da família (ownerId
 * null) + planos pessoais do próprio. Inclui apenas não-arquivados por default.
 */
export async function listVisiblePlans(
  orgId: string,
  userId: string,
  options: { includeArchived?: boolean } = {},
): Promise<PlanWithProgress[]> {
  const where = [
    eq(plan.organizationId, orgId),
    or(isNull(plan.ownerId), eq(plan.ownerId, userId))!,
  ];
  if (!options.includeArchived) {
    where.push(eq(plan.archived, false));
  }
  const rows = await db
    .select()
    .from(plan)
    .where(and(...where))
    .orderBy(asc(plan.endDate));
  const resolved = await resolveLinkedProgress(orgId, rows);
  return rows.map((row) => {
    const r = resolved.get(row.id)!;
    return computeProgress(row, r.linked, r.current);
  });
}

export async function getPlan(
  orgId: string,
  planId: string,
): Promise<PlanWithProgress | null> {
  const [row] = await db
    .select()
    .from(plan)
    .where(and(eq(plan.organizationId, orgId), eq(plan.id, planId)))
    .limit(1);
  if (!row) return null;
  const resolved = await resolveLinkedProgress(orgId, [row]);
  const r = resolved.get(row.id)!;
  return computeProgress(row, r.linked, r.current);
}

export async function listContributions(
  planId: string,
): Promise<Array<typeof planContribution.$inferSelect>> {
  return db
    .select()
    .from(planContribution)
    .where(eq(planContribution.planId, planId))
    .orderBy(desc(planContribution.occurredOn));
}

/**
 * Recalcula current_cents do plano a partir das contribuições. Útil depois
 * de qualquer mutação em planContribution.
 */
export async function recomputePlanCurrent(planId: string): Promise<void> {
  const [row] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${planContribution.amountCents}), 0)::text`,
    })
    .from(planContribution)
    .where(eq(planContribution.planId, planId));
  const total = Math.round(Number(row?.total ?? 0));
  await db
    .update(plan)
    .set({ currentCents: total, updatedAt: new Date() })
    .where(eq(plan.id, planId));
}
