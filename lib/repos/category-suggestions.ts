import "server-only";

import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  categorizationRule,
  category,
  transaction,
} from "@/db/schema/finance";

const STOPWORDS = new Set([
  "de", "da", "do", "das", "dos",
  "para", "com", "sem", "por", "pelo", "pela",
  "em", "no", "na", "nos", "nas",
  "pagamento", "recebido", "enviado",
  "pix", "ted", "doc", "tef", "transf", "transferencia",
  "boleto", "compra", "debito", "credito", "fatura",
  "online", "mobile", "internet", "loja",
  "ltda", "me", "sa", "eireli", "epp",
]);

export function normalizeDescription(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): string[] {
  return normalizeDescription(s)
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

export const DESCRIPTION_NORMALIZE_SQL = sql`lower(translate(coalesce(${transaction.cleanDescription}, ${transaction.description}), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))`;
const NORMALIZE_SQL = DESCRIPTION_NORMALIZE_SQL;

const LOOKBACK_DAYS = 365;

export type Suggestion = {
  categoryId: string;
  confidence: "high" | "medium" | "low";
};

/**
 * Sugere uma categoria para um lançamento com base no histórico já categorizado
 * da organização. Estágios:
 *   1. exact-match em cleanDescription (ou description) normalizado
 *   2. fallback por overlap de tokens (Jaccard)
 *
 * Retorna null se não houver sinal suficiente.
 */
export async function suggestCategoryForTransaction(
  orgId: string,
  kind: "income" | "expense",
  rawDescription: string,
  cleanDescription?: string | null,
): Promise<Suggestion | null> {
  const target = (cleanDescription?.trim() || rawDescription).trim();
  if (!target) return null;
  const normTarget = normalizeDescription(target);
  if (!normTarget) return null;

  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);
  const sinceISO = since.toISOString().slice(0, 10);

  // Estágio 0: regra explícita em categorization_rule. NÃO filtra por kind:
  // o usuário pode lançar income em categoria expense (e vice-versa) pra
  // abater num reembolso, então qualquer categoria histórica é candidata.
  const ruleRows = await db
    .select({
      categoryId: categorizationRule.categoryId,
      hitCount: categorizationRule.hitCount,
    })
    .from(categorizationRule)
    .innerJoin(category, eq(categorizationRule.categoryId, category.id))
    .where(
      and(
        eq(categorizationRule.organizationId, orgId),
        eq(categorizationRule.descriptionNorm, normTarget),
        eq(category.archived, false),
      ),
    )
    .orderBy(sql`${categorizationRule.hitCount} DESC`)
    .limit(1);
  if (ruleRows.length > 0 && ruleRows[0].categoryId) {
    const hit = ruleRows[0].hitCount;
    const confidence: Suggestion["confidence"] =
      hit >= 3 ? "high" : hit >= 2 ? "medium" : "low";
    return { categoryId: ruleRows[0].categoryId, confidence };
  }

  // Estágio 1: exact match em descrição normalizada (igualmente sem filtro de kind)
  const exactRows = await db
    .select({
      categoryId: transaction.categoryId,
      count: sql<number>`count(*)::int`,
    })
    .from(transaction)
    .innerJoin(category, eq(transaction.categoryId, category.id))
    .where(
      and(
        eq(transaction.organizationId, orgId),
        isNotNull(transaction.categoryId),
        eq(category.archived, false),
        gte(transaction.occurredOn, sinceISO),
        sql`${NORMALIZE_SQL} = ${normTarget}`,
      ),
    )
    .groupBy(transaction.categoryId);

  if (exactRows.length > 0) {
    const total = exactRows.reduce((s, r) => s + r.count, 0);
    const best = exactRows.reduce((a, b) => (a.count >= b.count ? a : b));
    if (best.categoryId && best.count / total >= 0.6) {
      const ratio = best.count / total;
      const confidence: Suggestion["confidence"] =
        best.count >= 3 || ratio >= 0.8 ? "high" : "medium";
      return { categoryId: best.categoryId, confidence };
    }
  }

  // Estágio 2: token overlap
  const targetTokens = new Set(tokenize(target));
  if (targetTokens.size === 0) return null;

  const rows = await db
    .select({
      categoryId: transaction.categoryId,
      cleanDescription: transaction.cleanDescription,
      description: transaction.description,
    })
    .from(transaction)
    .innerJoin(category, eq(transaction.categoryId, category.id))
    .where(
      and(
        eq(transaction.organizationId, orgId),
        isNotNull(transaction.categoryId),
        eq(category.archived, false),
        gte(transaction.occurredOn, sinceISO),
      ),
    );

  type Score = { categoryId: string; total: number; count: number };
  const scores = new Map<string, Score>();
  for (const r of rows) {
    if (!r.categoryId) continue;
    const candidate = (r.cleanDescription ?? r.description) || "";
    const candTokens = tokenize(candidate);
    if (candTokens.length === 0) continue;
    let overlap = 0;
    for (const t of candTokens) if (targetTokens.has(t)) overlap++;
    if (overlap === 0) continue;
    const union = new Set([...candTokens, ...Array.from(targetTokens)]);
    const score = overlap / union.size;
    if (score < 0.3) continue;
    const cur = scores.get(r.categoryId) ?? {
      categoryId: r.categoryId,
      total: 0,
      count: 0,
    };
    cur.total += score;
    cur.count += 1;
    scores.set(r.categoryId, cur);
  }

  if (scores.size === 0) return null;

  let best: Score | null = null;
  for (const s of scores.values()) {
    if (!best || s.total > best.total) best = s;
  }
  if (best && best.count >= 2 && best.total >= 0.7) {
    const confidence: Suggestion["confidence"] =
      best.count >= 4 && best.total >= 1.2 ? "medium" : "low";
    return { categoryId: best.categoryId, confidence };
  }

  return null;
}

/**
 * Retorna a categoria a aplicar automaticamente, ou null se a confiança for baixa demais.
 * Usada nos pontos de criação manual e na importação.
 */
export async function getAutoApplyCategoryId(
  orgId: string,
  kind: "income" | "expense",
  rawDescription: string,
  cleanDescription?: string | null,
): Promise<string | null> {
  const s = await suggestCategoryForTransaction(
    orgId,
    kind,
    rawDescription,
    cleanDescription,
  );
  if (!s) return null;
  return s.confidence === "high" || s.confidence === "medium"
    ? s.categoryId
    : null;
}
