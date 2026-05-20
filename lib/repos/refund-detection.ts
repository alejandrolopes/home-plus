import "server-only";

import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { transaction } from "@/db/schema/finance";

const STOPWORDS = new Set([
  "de", "da", "do", "das", "dos",
  "para", "com", "sem", "por", "pelo", "pela",
  "em", "no", "na", "nos", "nas",
  "pagamento", "recebido", "enviado",
  "pix", "ted", "doc", "tef", "transf", "transferencia",
  "boleto", "compra", "debito", "credito", "fatura",
  "estorno", "reembolso", "cancelamento", "devolucao",
  "online", "mobile", "internet", "loja",
  "ltda", "me", "sa", "eireli", "epp",
]);

function normalize(s: string): string {
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
  return normalize(s)
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

function sameCounterparty(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  return normalize(a) === normalize(b) && normalize(a).length > 0;
}

function daysBetween(isoA: string, isoB: string): number {
  const a = new Date(`${isoA}T00:00:00`).getTime();
  const b = new Date(`${isoB}T00:00:00`).getTime();
  return Math.abs(Math.round((a - b) / (1000 * 60 * 60 * 24)));
}

export type RefundInputTransaction = {
  key: string;
  kind: "income" | "expense";
  amount: string;
  description: string;
  cleanDescription?: string | null;
  counterpartyName?: string | null;
  occurredOn: string;
};

export type RefundCandidate = {
  refundKey: string;
  refundDescription: string;
  refundOccurredOn: string;
  amount: string;
  /** Quando o débito original também está no mesmo lote sendo importado. */
  originalKey?: string;
  /** Quando o débito original já está no banco. */
  originalTransactionId?: string;
  originalDescription: string;
  originalOccurredOn: string;
  daysDiff: number;
  confidence: "high" | "medium" | "low";
};

const LOOKBACK_DAYS = 90;

function scorePair(
  refund: RefundInputTransaction,
  original: {
    description: string;
    cleanDescription?: string | null;
    counterpartyName?: string | null;
  },
): RefundCandidate["confidence"] | null {
  if (sameCounterparty(refund.counterpartyName, original.counterpartyName)) {
    return "high";
  }
  const refundText = refund.cleanDescription || refund.description;
  const originalText = original.cleanDescription || original.description;
  const refundTokens = new Set(tokenize(refundText));
  const originalTokens = new Set(tokenize(originalText));
  const score = jaccard(refundTokens, originalTokens);
  if (score >= 0.6) return "high";
  if (score >= 0.4) return "medium";
  if (score >= 0.25) return "low";
  return null;
}

/**
 * Identifica candidatos a estorno entre as transações sendo importadas e:
 *   1. Outras transações do mesmo lote (estorno + débito no mesmo arquivo)
 *   2. Transações já gravadas no banco para a mesma conta (até 90 dias)
 *
 * Critérios: mesma conta, kinds opostos (income estornando expense), mesmo
 * amount exato, descrição/counterparty parecidos.
 *
 * Cada transação só vira candidata em um par (o melhor match).
 */
export async function detectRefundCandidates(params: {
  orgId: string;
  /** Vazio quando ainda não há conta resolvida (modo "nova conta") — pula matching contra o banco. */
  accountId: string;
  newTransactions: RefundInputTransaction[];
}): Promise<RefundCandidate[]> {
  const { orgId, accountId, newTransactions } = params;

  const refunds = newTransactions.filter((t) => t.kind === "income");
  if (refunds.length === 0) return [];

  const newExpenses = newTransactions.filter((t) => t.kind === "expense");
  const candidates: RefundCandidate[] = [];
  const usedRefundKeys = new Set<string>();
  const usedOriginalKeys = new Set<string>();
  const usedOriginalIds = new Set<string>();

  // === 1. Match intra-lote ===
  type IntraMatch = {
    refund: RefundInputTransaction;
    original: RefundInputTransaction;
    confidence: RefundCandidate["confidence"];
    daysDiff: number;
  };
  const intraMatches: IntraMatch[] = [];
  for (const r of refunds) {
    for (const e of newExpenses) {
      if (e.amount !== r.amount) continue;
      const days = daysBetween(r.occurredOn, e.occurredOn);
      if (days > LOOKBACK_DAYS) continue;
      const conf = scorePair(r, e);
      if (!conf) continue;
      intraMatches.push({ refund: r, original: e, confidence: conf, daysDiff: days });
    }
  }
  // Prioriza pares mais confiáveis e mais próximos no tempo
  const confRank = { high: 3, medium: 2, low: 1 } as const;
  intraMatches.sort(
    (a, b) =>
      confRank[b.confidence] - confRank[a.confidence] ||
      a.daysDiff - b.daysDiff,
  );
  for (const m of intraMatches) {
    if (usedRefundKeys.has(m.refund.key)) continue;
    if (usedOriginalKeys.has(m.original.key)) continue;
    candidates.push({
      refundKey: m.refund.key,
      refundDescription: m.refund.description,
      refundOccurredOn: m.refund.occurredOn,
      amount: m.refund.amount,
      originalKey: m.original.key,
      originalDescription: m.original.description,
      originalOccurredOn: m.original.occurredOn,
      daysDiff: m.daysDiff,
      confidence: m.confidence,
    });
    usedRefundKeys.add(m.refund.key);
    usedOriginalKeys.add(m.original.key);
  }

  // === 2. Match contra banco para estornos ainda não pareados ===
  if (!accountId) return candidates;
  const remainingRefunds = refunds.filter((r) => !usedRefundKeys.has(r.key));
  if (remainingRefunds.length === 0) return candidates;

  const amounts = Array.from(new Set(remainingRefunds.map((r) => r.amount)));
  const minDateIso = remainingRefunds
    .map((r) => r.occurredOn)
    .reduce((min, d) => (d < min ? d : min), remainingRefunds[0].occurredOn);
  const maxDateIso = remainingRefunds
    .map((r) => r.occurredOn)
    .reduce((max, d) => (d > max ? d : max), remainingRefunds[0].occurredOn);
  const lookbackStart = new Date(`${minDateIso}T00:00:00`);
  lookbackStart.setDate(lookbackStart.getDate() - LOOKBACK_DAYS);
  const lookbackStartIso = lookbackStart.toISOString().slice(0, 10);

  const dbRows = await db
    .select({
      id: transaction.id,
      amount: transaction.amount,
      description: transaction.description,
      cleanDescription: transaction.cleanDescription,
      counterpartyName: transaction.counterpartyName,
      occurredOn: transaction.occurredOn,
      purchaseDate: transaction.purchaseDate,
    })
    .from(transaction)
    .where(
      and(
        eq(transaction.organizationId, orgId),
        eq(transaction.accountId, accountId),
        eq(transaction.kind, "expense"),
        inArray(transaction.amount, amounts),
        isNull(transaction.reversesTransactionId),
        gte(transaction.purchaseDate, lookbackStartIso),
        lte(transaction.purchaseDate, maxDateIso),
        sql`NOT EXISTS (
          SELECT 1 FROM ${transaction} other
          WHERE other.reverses_transaction_id = ${transaction.id}
        )`,
      ),
    );

  type DbMatch = {
    refund: RefundInputTransaction;
    row: (typeof dbRows)[number];
    confidence: RefundCandidate["confidence"];
    daysDiff: number;
  };
  const dbMatches: DbMatch[] = [];
  for (const r of remainingRefunds) {
    for (const row of dbRows) {
      if (row.amount !== r.amount) continue;
      const refDate = row.purchaseDate ?? row.occurredOn;
      const days = daysBetween(r.occurredOn, refDate);
      if (days > LOOKBACK_DAYS) continue;
      const conf = scorePair(r, {
        description: row.description,
        cleanDescription: row.cleanDescription,
        counterpartyName: row.counterpartyName,
      });
      if (!conf) continue;
      dbMatches.push({ refund: r, row, confidence: conf, daysDiff: days });
    }
  }
  dbMatches.sort(
    (a, b) =>
      confRank[b.confidence] - confRank[a.confidence] ||
      a.daysDiff - b.daysDiff,
  );
  for (const m of dbMatches) {
    if (usedRefundKeys.has(m.refund.key)) continue;
    if (usedOriginalIds.has(m.row.id)) continue;
    candidates.push({
      refundKey: m.refund.key,
      refundDescription: m.refund.description,
      refundOccurredOn: m.refund.occurredOn,
      amount: m.refund.amount,
      originalTransactionId: m.row.id,
      originalDescription: m.row.description,
      originalOccurredOn: m.row.purchaseDate ?? m.row.occurredOn,
      daysDiff: m.daysDiff,
      confidence: m.confidence,
    });
    usedRefundKeys.add(m.refund.key);
    usedOriginalIds.add(m.row.id);
  }

  return candidates;
}
