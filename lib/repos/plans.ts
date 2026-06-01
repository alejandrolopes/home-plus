import "server-only";

import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { plan, planContribution } from "@/db/schema/finance";

export type PlanRow = typeof plan.$inferSelect;

export type PlanWithProgress = PlanRow & {
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

function computeProgress(row: PlanRow): PlanWithProgress {
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
  const remainingCents = Math.max(0, row.targetCents - row.currentCents);
  const progress =
    row.targetCents > 0 ? row.currentCents / row.targetCents : 0;
  let status: PlanWithProgress["status"];
  if (row.currentCents >= row.targetCents) status = "completed";
  else if (row.currentCents >= expectedCents * 1.05) status = "ahead";
  else if (row.currentCents >= expectedCents * 0.9) status = "on_track";
  else status = "behind";
  return {
    ...row,
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
  return rows.map(computeProgress);
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
  return row ? computeProgress(row) : null;
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
