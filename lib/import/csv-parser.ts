import { createHash } from "node:crypto";
import Papa from "papaparse";
import type {
  ImportAccountKind,
  ParsedImport,
  ParsedTransaction,
} from "./types";

type Row = Record<string, string>;

const BANK_DATE_KEYS = ["data", "data lancamento", "data lançamento"];
const BANK_AMOUNT_KEYS = ["valor", "valor (r$)"];
const BANK_ID_KEYS = ["identificador", "id", "fitid"];
const BANK_DESC_KEYS = [
  "descrição",
  "descricao",
  "histórico",
  "historico",
  "memo",
];

const CARD_DATE_KEYS = ["date"];
const CARD_AMOUNT_KEYS = ["amount"];
const CARD_DESC_KEYS = ["title"];

const INSTALLMENT_RE = /\s*-\s*Parcela\s+(\d+)\s*\/\s*(\d+)\s*$/i;

function pickKey(row: Row, candidates: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const found = keys.find((k) => k.trim().toLowerCase() === c);
    if (found) return found;
  }
  return undefined;
}

function parseAnyDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function parseAmount(raw: string): number | null {
  let s = raw.trim().replace(/[R$\s]/g, "");
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastComma > lastDot) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

function detectKind(sample: Row): ImportAccountKind {
  const keys = Object.keys(sample).map((k) => k.trim().toLowerCase());
  if (keys.includes("title") && keys.includes("amount") && keys.includes("date"))
    return "credit_card";
  return "bank";
}

function hashRow(date: string, amount: string, title: string): string {
  return createHash("sha256")
    .update(`${date}|${amount}|${title}`)
    .digest("hex")
    .slice(0, 32);
}

export function parseCsv(raw: string): ParsedImport {
  const cleaned = raw.replace(/^﻿/, "");
  const result = Papa.parse<Row>(cleaned, {
    header: true,
    skipEmptyLines: true,
    delimitersToGuess: [",", ";", "\t"],
    transformHeader: (h) => h.trim(),
  });

  const rows = result.data;
  if (rows.length === 0) {
    return {
      source: "csv",
      accountKind: "bank",
      metadata: null,
      periodStart: null,
      periodEnd: null,
      transactions: [],
    };
  }

  const accountKind = detectKind(rows[0]);
  const transactions: ParsedTransaction[] =
    accountKind === "credit_card" ? parseCardRows(rows) : parseBankRows(rows);

  transactions.sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));

  const periodStart = transactions[0]?.occurredOn ?? null;
  const periodEnd = transactions[transactions.length - 1]?.occurredOn ?? null;

  return {
    source: "csv",
    accountKind,
    metadata: null,
    periodStart,
    periodEnd,
    transactions,
  };
}

function parseBankRows(rows: Row[]): ParsedTransaction[] {
  const sample = rows[0];
  const dateKey = pickKey(sample, BANK_DATE_KEYS);
  const amountKey = pickKey(sample, BANK_AMOUNT_KEYS);
  const idKey = pickKey(sample, BANK_ID_KEYS);
  const descKey = pickKey(sample, BANK_DESC_KEYS);

  if (!dateKey || !amountKey || !descKey) {
    throw new Error(
      "CSV de conta inválido: precisa ter colunas Data, Valor e Descrição.",
    );
  }

  const out: ParsedTransaction[] = [];
  for (const row of rows) {
    const dateRaw = (row[dateKey] ?? "").trim();
    const amountRaw = (row[amountKey] ?? "").trim();
    const descRaw = (row[descKey] ?? "").trim();
    if (!dateRaw || !amountRaw) continue;

    const date = parseAnyDate(dateRaw);
    const amount = parseAmount(amountRaw);
    if (!date || amount == null) continue;

    out.push({
      externalId: idKey ? (row[idKey] ?? "").trim() || null : null,
      occurredOn: date,
      amount: Math.abs(amount).toFixed(2),
      kind: amount >= 0 ? "income" : "expense",
      description: descRaw,
      installmentNumber: null,
      installmentTotal: null,
      isPaymentReceived: false,
    });
  }
  return out;
}

function parseCardRows(rows: Row[]): ParsedTransaction[] {
  const sample = rows[0];
  const dateKey = pickKey(sample, CARD_DATE_KEYS);
  const amountKey = pickKey(sample, CARD_AMOUNT_KEYS);
  const descKey = pickKey(sample, CARD_DESC_KEYS);

  if (!dateKey || !amountKey || !descKey) {
    throw new Error(
      "CSV de cartão inválido: precisa ter colunas date, title e amount.",
    );
  }

  const out: ParsedTransaction[] = [];
  for (const row of rows) {
    const dateRaw = (row[dateKey] ?? "").trim();
    const amountRaw = (row[amountKey] ?? "").trim();
    const titleRaw = (row[descKey] ?? "").trim();
    if (!dateRaw || !amountRaw) continue;

    const date = parseAnyDate(dateRaw);
    const amount = parseAmount(amountRaw);
    if (!date || amount == null) continue;

    // Card CSV: positive = expense, negative = credit
    const kind: "income" | "expense" = amount > 0 ? "expense" : "income";
    const absAmount = Math.abs(amount).toFixed(2);
    const installment = titleRaw.match(INSTALLMENT_RE);
    const isPaymentReceived =
      kind === "income" && /^pagamento\s+recebido$/i.test(titleRaw);

    out.push({
      externalId: hashRow(date, absAmount, titleRaw),
      occurredOn: date,
      amount: absAmount,
      kind,
      description: titleRaw,
      installmentNumber: installment ? Number(installment[1]) : null,
      installmentTotal: installment ? Number(installment[2]) : null,
      isPaymentReceived,
    });
  }
  return out;
}
