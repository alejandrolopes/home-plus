import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  organizationFinanceSettings,
  transaction,
  userFinanceSettings,
} from "@/db/schema";

export type FinanceSettings = {
  tithingEnabled: boolean;
  tithingPct: string;
  pactOfferingPct: string;
};

export type UserFinanceSettings = {
  tithingPct: string;
  pactOfferingPct: string;
};

// Dízimo é fixo em 10% por convenção bíblica/eclesiástica; não é editável
// pelo usuário. A oferta pacto é por usuário (cada um define a sua).
export const TITHING_PCT = "10";

const DEFAULTS: FinanceSettings = {
  tithingEnabled: false,
  tithingPct: TITHING_PCT,
  pactOfferingPct: "0",
};

export async function getFinanceSettings(
  organizationId: string,
): Promise<FinanceSettings> {
  const [row] = await db
    .select({
      tithingEnabled: organizationFinanceSettings.tithingEnabled,
      tithingPct: organizationFinanceSettings.tithingPct,
      pactOfferingPct: organizationFinanceSettings.pactOfferingPct,
    })
    .from(organizationFinanceSettings)
    .where(eq(organizationFinanceSettings.organizationId, organizationId))
    .limit(1);

  return row ?? DEFAULTS;
}

/**
 * Retorna a Fidelidade efetiva do usuário: o on/off vem da organização
 * (admin habilita a feature pra família) e os % vêm do override do usuário,
 * caindo nos defaults da organização quando o usuário ainda não definiu.
 */
export async function getEffectiveFinanceSettings(
  organizationId: string,
  userId: string,
): Promise<FinanceSettings> {
  const [orgRow] = await db
    .select({
      tithingEnabled: organizationFinanceSettings.tithingEnabled,
      tithingPct: organizationFinanceSettings.tithingPct,
      pactOfferingPct: organizationFinanceSettings.pactOfferingPct,
    })
    .from(organizationFinanceSettings)
    .where(eq(organizationFinanceSettings.organizationId, organizationId))
    .limit(1);

  const [userRow] = await db
    .select({
      tithingPct: userFinanceSettings.tithingPct,
      pactOfferingPct: userFinanceSettings.pactOfferingPct,
    })
    .from(userFinanceSettings)
    .where(
      and(
        eq(userFinanceSettings.organizationId, organizationId),
        eq(userFinanceSettings.userId, userId),
      ),
    )
    .limit(1);

  return {
    tithingEnabled: orgRow?.tithingEnabled ?? DEFAULTS.tithingEnabled,
    tithingPct: TITHING_PCT,
    pactOfferingPct:
      userRow?.pactOfferingPct ??
      orgRow?.pactOfferingPct ??
      DEFAULTS.pactOfferingPct,
  };
}

export async function upsertUserFinanceSettings(
  organizationId: string,
  userId: string,
  patch: Partial<UserFinanceSettings>,
): Promise<void> {
  const [current] = await db
    .select({
      tithingPct: userFinanceSettings.tithingPct,
      pactOfferingPct: userFinanceSettings.pactOfferingPct,
    })
    .from(userFinanceSettings)
    .where(
      and(
        eq(userFinanceSettings.organizationId, organizationId),
        eq(userFinanceSettings.userId, userId),
      ),
    )
    .limit(1);

  const merged = {
    tithingPct: patch.tithingPct ?? current?.tithingPct ?? DEFAULTS.tithingPct,
    pactOfferingPct:
      patch.pactOfferingPct ??
      current?.pactOfferingPct ??
      DEFAULTS.pactOfferingPct,
  };

  await db
    .insert(userFinanceSettings)
    .values({
      organizationId,
      userId,
      tithingPct: merged.tithingPct,
      pactOfferingPct: merged.pactOfferingPct,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [userFinanceSettings.organizationId, userFinanceSettings.userId],
      set: {
        tithingPct: merged.tithingPct,
        pactOfferingPct: merged.pactOfferingPct,
        updatedAt: new Date(),
      },
    });
}

export async function tithableBaseInRange(
  organizationId: string,
  filters: { from: string; to: string; ownerId?: string },
): Promise<string> {
  const where = [
    eq(transaction.organizationId, organizationId),
    eq(transaction.kind, "income"),
    eq(transaction.isTithable, true),
    gte(transaction.occurredOn, filters.from),
    lte(transaction.occurredOn, filters.to),
  ];
  if (filters.ownerId) {
    where.push(eq(transaction.ownerId, filters.ownerId));
  }
  const [row] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${transaction.amount}), 0)`,
    })
    .from(transaction)
    .where(and(...where));
  return row?.total ?? "0";
}

export async function upsertFinanceSettings(
  organizationId: string,
  patch: Partial<FinanceSettings>,
): Promise<void> {
  const current = await getFinanceSettings(organizationId);
  const merged = { ...current, ...patch };
  await db
    .insert(organizationFinanceSettings)
    .values({
      organizationId,
      tithingEnabled: merged.tithingEnabled,
      tithingPct: merged.tithingPct,
      pactOfferingPct: merged.pactOfferingPct,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: organizationFinanceSettings.organizationId,
      set: {
        tithingEnabled: merged.tithingEnabled,
        tithingPct: merged.tithingPct,
        pactOfferingPct: merged.pactOfferingPct,
        updatedAt: new Date(),
      },
    });
}
