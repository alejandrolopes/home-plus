import type {
  ImportAccountKind,
  ParsedAccountMetadata,
  ParsedImport,
  ParsedTransaction,
} from "./types";

/**
 * Parses OFX 1.x (SGML) and 2.x (XML) bank statements.
 * Targets `<STMTTRN>` blocks; handles Brazilian banks (Nubank, Itaú, Bradesco, etc).
 */

function stripOfxHeader(raw: string): string {
  const idx = raw.indexOf("<OFX>");
  return idx >= 0 ? raw.slice(idx) : raw;
}

function getTagValue(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i");
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

function parseOfxDate(raw: string): string {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return raw;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function extractMetadata(content: string): ParsedAccountMetadata {
  const meta: ParsedAccountMetadata = {};
  const orgMatch = content.match(/<ORG>([^<\r\n]*)/i);
  if (orgMatch) meta.bankName = orgMatch[1].trim();
  const fidMatch = content.match(/<FID>([^<\r\n]*)/i);
  if (fidMatch) meta.bankId = fidMatch[1].trim();
  const branchMatch = content.match(/<BRANCHID>([^<\r\n]*)/i);
  if (branchMatch) meta.accountBranch = branchMatch[1].trim();
  const acctMatch = content.match(/<ACCTID>([^<\r\n]*)/i);
  if (acctMatch) meta.accountNumber = acctMatch[1].trim();
  const curMatch = content.match(/<CURDEF>([^<\r\n]*)/i);
  if (curMatch) meta.currency = curMatch[1].trim();
  const balMatch = content.match(
    /<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]*)/i,
  );
  if (balMatch) meta.closingBalance = balMatch[1].trim();
  return meta;
}

const INSTALLMENT_RE = /\s*-\s*Parcela\s+(\d+)\s*\/\s*(\d+)\s*$/i;

function extractTransactions(
  content: string,
  accountKind: ImportAccountKind,
): ParsedTransaction[] {
  const out: ParsedTransaction[] = [];
  const re = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const block = m[1];
    const dateRaw = getTagValue(block, "DTPOSTED");
    const amountRaw = getTagValue(block, "TRNAMT");
    const fitid = getTagValue(block, "FITID");
    const memo = getTagValue(block, "MEMO") ?? getTagValue(block, "NAME") ?? "";
    if (!dateRaw || !amountRaw) continue;

    const amountNum = Number(amountRaw);
    if (Number.isNaN(amountNum)) continue;

    let kind: "income" | "expense";
    if (accountKind === "credit_card") {
      kind = amountNum < 0 ? "expense" : "income";
    } else {
      kind = amountNum > 0 ? "income" : "expense";
    }
    const absAmount = Math.abs(amountNum).toFixed(2);

    const installment = memo.match(INSTALLMENT_RE);

    out.push({
      externalId: fitid ?? null,
      occurredOn: parseOfxDate(dateRaw),
      amount: absAmount,
      kind,
      description: memo,
      installmentNumber: installment ? Number(installment[1]) : null,
      installmentTotal: installment ? Number(installment[2]) : null,
      isPaymentReceived:
        accountKind === "credit_card" &&
        kind === "income" &&
        /^pagamento\s+recebido$/i.test(memo.trim()),
    });
  }
  return out;
}

function extractPeriod(content: string): {
  start: string | null;
  end: string | null;
} {
  const startMatch = content.match(/<DTSTART>([^<\r\n]*)/i);
  const endMatch = content.match(/<DTEND>([^<\r\n]*)/i);
  return {
    start: startMatch ? parseOfxDate(startMatch[1].trim()) : null,
    end: endMatch ? parseOfxDate(endMatch[1].trim()) : null,
  };
}

function detectKind(content: string): ImportAccountKind {
  if (/<CREDITCARDMSGSRSV1>|<CCSTMTRS>|<CCACCTFROM>/i.test(content))
    return "credit_card";
  return "bank";
}

export function parseOfx(raw: string): ParsedImport {
  const content = stripOfxHeader(raw);
  const accountKind = detectKind(content);
  const metadata = extractMetadata(content);
  const transactions = extractTransactions(content, accountKind);
  const period = extractPeriod(content);

  transactions.sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));

  return {
    source: "ofx",
    accountKind,
    metadata,
    periodStart: period.start,
    periodEnd: period.end,
    transactions,
  };
}
