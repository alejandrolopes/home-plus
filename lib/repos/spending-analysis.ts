import "server-only";

import { and, eq, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  category,
  financialAccount,
  transaction,
} from "@/db/schema/finance";

export type RoleValue = "luxury" | "essential";

export type SpendingCategoryRow = {
  categoryId: string;
  categoryName: string;
  categoryColor: string | null;
  total: number;
};

/**
 * Soma despesas (kind=expense) agrupadas por categoria, filtrado por role.
 * Ignora transferências entre contas do mesmo dono (mesmo critério dos
 * relatórios). Considera escopo do owner pra refletir só os gastos do user.
 */
export async function getSpendingByRole(
  orgId: string,
  ownerId: string,
  from: string,
  to: string,
  role: RoleValue,
): Promise<SpendingCategoryRow[]> {
  const rows = await db
    .select({
      categoryId: category.id,
      categoryName: category.name,
      categoryColor: category.color,
      total: sql<string>`COALESCE(SUM(${transaction.amount}), 0)::text`,
    })
    .from(transaction)
    .innerJoin(category, eq(category.id, transaction.categoryId))
    .leftJoin(
      financialAccount,
      eq(financialAccount.id, transaction.accountId),
    )
    .where(
      and(
        eq(transaction.organizationId, orgId),
        eq(transaction.ownerId, ownerId),
        eq(transaction.kind, "expense"),
        eq(category.role, role),
        // Splits: exclui o pai (umbrella) e mantém as filhas categorizadas.
        // Mesma lógica de /relatorios — pai geralmente não tem categoria, e
        // contar pai+filhas dobraria os valores.
        sql`NOT EXISTS (
          SELECT 1 FROM ${transaction} c
          WHERE c.parent_transaction_id = ${transaction.id}
        )`,
        gte(transaction.occurredOn, from),
        lte(transaction.occurredOn, to),
        or(
          isNull(transaction.transferToAccountId),
          sql`NOT EXISTS (
            SELECT 1 FROM ${financialAccount} dest
            WHERE dest.id = ${transaction.transferToAccountId}
              AND dest.owner_id = ${transaction.ownerId}
          )`,
        ),
      ),
    )
    .groupBy(category.id)
    .orderBy(sql`SUM(${transaction.amount}) DESC NULLS LAST`);

  return rows.map((r) => ({
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    categoryColor: r.categoryColor,
    total: Number(r.total),
  }));
}

/** Total geral de despesas no período (denominador pra % do orçamento). */
export async function getTotalExpenses(
  orgId: string,
  ownerId: string,
  from: string,
  to: string,
): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${transaction.amount}), 0)::text`,
    })
    .from(transaction)
    .where(
      and(
        eq(transaction.organizationId, orgId),
        eq(transaction.ownerId, ownerId),
        eq(transaction.kind, "expense"),
        // Splits: exclui o pai (umbrella) e mantém as filhas categorizadas.
        // Mesma lógica de /relatorios — pai geralmente não tem categoria, e
        // contar pai+filhas dobraria os valores.
        sql`NOT EXISTS (
          SELECT 1 FROM ${transaction} c
          WHERE c.parent_transaction_id = ${transaction.id}
        )`,
        gte(transaction.occurredOn, from),
        lte(transaction.occurredOn, to),
        or(
          isNull(transaction.transferToAccountId),
          sql`NOT EXISTS (
            SELECT 1 FROM ${financialAccount} dest
            WHERE dest.id = ${transaction.transferToAccountId}
              AND dest.owner_id = ${transaction.ownerId}
          )`,
        ),
      ),
    );
  return Number(row?.total ?? 0);
}

export type MonthlyPoint = { month: string; total: number };
export type CategoryHistory = {
  categoryId: string;
  categoryName: string;
  categoryColor: string | null;
  points: MonthlyPoint[]; // ordenado cronologicamente
};

/**
 * Histórico mensal por categoria essencial no range [startMonth..endMonth]
 * (ambos inclusive, no formato 'YYYY-MM'). Retorna pontos pra TODO mês do
 * range — meses sem lançamentos vêm com total=0, pra desenhar a linha bem.
 */
export async function getMonthlyHistoryByRole(
  orgId: string,
  ownerId: string,
  role: RoleValue,
  startMonth: string,
  endMonth: string,
): Promise<CategoryHistory[]> {
  const startISO = `${startMonth}-01`;
  // Último dia do mês final
  const [eY, eM] = endMonth.split("-").map(Number);
  const endLast = new Date(eY, eM, 0); // day 0 of next month = last day of this month
  const endISO = `${endLast.getFullYear()}-${String(endLast.getMonth() + 1).padStart(2, "0")}-${String(endLast.getDate()).padStart(2, "0")}`;

  const rows = await db
    .select({
      categoryId: category.id,
      categoryName: category.name,
      categoryColor: category.color,
      month: sql<string>`TO_CHAR(${transaction.occurredOn}, 'YYYY-MM')`,
      total: sql<string>`COALESCE(SUM(${transaction.amount}), 0)::text`,
    })
    .from(transaction)
    .innerJoin(category, eq(category.id, transaction.categoryId))
    .where(
      and(
        eq(transaction.organizationId, orgId),
        eq(transaction.ownerId, ownerId),
        eq(transaction.kind, "expense"),
        eq(category.role, role),
        // Splits: exclui o pai (umbrella) e mantém as filhas categorizadas.
        // Mesma lógica de /relatorios — pai geralmente não tem categoria, e
        // contar pai+filhas dobraria os valores.
        sql`NOT EXISTS (
          SELECT 1 FROM ${transaction} c
          WHERE c.parent_transaction_id = ${transaction.id}
        )`,
        gte(transaction.occurredOn, startISO),
        lte(transaction.occurredOn, endISO),
        or(
          isNull(transaction.transferToAccountId),
          sql`NOT EXISTS (
            SELECT 1 FROM ${financialAccount} dest
            WHERE dest.id = ${transaction.transferToAccountId}
              AND dest.owner_id = ${transaction.ownerId}
          )`,
        ),
      ),
    )
    .groupBy(category.id, sql`TO_CHAR(${transaction.occurredOn}, 'YYYY-MM')`)
    .orderBy(category.name);

  // Garante todos os meses do range em cada série, com 0 quando vazio.
  const allMonths = enumerateMonths(startMonth, endMonth);
  const byCat = new Map<
    string,
    { name: string; color: string | null; vals: Map<string, number> }
  >();
  for (const r of rows) {
    const entry = byCat.get(r.categoryId) ?? {
      name: r.categoryName,
      color: r.categoryColor,
      vals: new Map<string, number>(),
    };
    entry.vals.set(r.month, Number(r.total));
    byCat.set(r.categoryId, entry);
  }

  const results: CategoryHistory[] = [];
  for (const [categoryId, entry] of byCat) {
    const points = allMonths.map((m) => ({
      month: m,
      total: entry.vals.get(m) ?? 0,
    }));
    results.push({
      categoryId,
      categoryName: entry.name,
      categoryColor: entry.color,
      points,
    });
  }
  // Inclui categorias essentials que NÃO tiveram nenhum lançamento — assim a
  // UI ainda mostra a linha zerada (útil pra ver que conta sumiu/é nova).
  const allRoleCats = await db
    .select({
      id: category.id,
      name: category.name,
      color: category.color,
    })
    .from(category)
    .where(
      and(
        eq(category.organizationId, orgId),
        eq(category.role, role),
        eq(category.archived, false),
      ),
    );
  for (const c of allRoleCats) {
    if (!byCat.has(c.id)) {
      results.push({
        categoryId: c.id,
        categoryName: c.name,
        categoryColor: c.color,
        points: allMonths.map((m) => ({ month: m, total: 0 })),
      });
    }
  }
  results.sort((a, b) => a.categoryName.localeCompare(b.categoryName, "pt-BR"));
  return results;
}

function enumerateMonths(startMonth: string, endMonth: string): string[] {
  const [sy, sm] = startMonth.split("-").map(Number);
  const [ey, em] = endMonth.split("-").map(Number);
  const out: string[] = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Heurística simples pra classificar categorias automaticamente pela primeira
 * vez. Match por substring no nome normalizado (sem acento, lowercase).
 * Devolve "luxury" | "essential" | null.
 */
export function defaultRoleFromName(name: string): RoleValue | null {
  const n = name
    .toLowerCase()
    .normalize("NFD")
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[̀-ͯ]/g, "");
  const luxuryKeywords = [
    "delivery",
    "ifood",
    "restaurante",
    "bar",
    "cafe",
    "café",
    "lanche",
    "assinatura",
    "streaming",
    "roupa",
    "calcado",
    "calçado",
    "vestuario",
    "vestuário",
    "acessor",
    "diversao",
    "diversão",
    "entreten",
    "cinema",
    "jogo",
    "lazer",
  ];
  const essentialKeywords = [
    "luz",
    "energia",
    "gas",
    "gás",
    "agua",
    "água",
    "saneament",
    "telefone",
    "internet",
    "celular",
    "vivo",
    "claro",
    "tim",
    "oi ",
  ];
  for (const k of luxuryKeywords) if (n.includes(k)) return "luxury";
  for (const k of essentialKeywords) if (n.includes(k)) return "essential";
  return null;
}

export async function countCategoriesWithRole(orgId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(category)
    .where(
      and(
        eq(category.organizationId, orgId),
        eq(category.archived, false),
        isNotNull(category.role),
      ),
    );
  return r?.n ?? 0;
}
