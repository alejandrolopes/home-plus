export type PaymentMethod =
  | "pix"
  | "ted"
  | "doc"
  | "boleto"
  | "fatura_cartao"
  | "transfer"
  | "salary"
  | "yield"
  | "other";

export type ParsedDescription = {
  cleanDescription: string;
  paymentMethod: PaymentMethod | null;
  direction: "in" | "out" | null;
  counterpartyName: string | null;
  counterpartyDocument: string | null;
  counterpartyBank: string | null;
  counterpartyBranch: string | null;
  counterpartyAccount: string | null;
};

const PIX_PREFIX_RE =
  /^Transfer[êe]ncia\s+(recebida|enviada)\s+pelo\s+Pix(?:\s+via\s+Open\s+Banking)?\s*-\s*(.+)$/i;

const TRANSFER_PREFIX_RE =
  /^Transfer[êe]ncia\s+(Recebida|Enviada)\s*-\s*(.+)$/i;

const FATURA_RE = /^Pagamento\s+de\s+fatura$/i;
const BOLETO_RE = /^Pagamento\s+de\s+boleto\s+efetuado(?:\s*-\s*(.+))?$/i;
const CREDITO_CONTA_RE = /^Cr[ée]dito\s+em\s+conta$/i;
const RENDIMENTO_RE = /^Rendimento(?:s)?(?:\s+.*)?$/i;
const SALARIO_RE = /^(?:Sal[áa]rio|Pagamento\s+de\s+sal[áa]rio)/i;

const CPF_MASKED_RE = /^•••\.\d{3}\.\d{3}-••$/;
const CPF_FULL_RE = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/;
const CNPJ_RE = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;

const LOWERCASE_WORDS =
  /^(de|da|do|das|dos|e|para|a|com|em|na|no|nas|nos|s\.?a\.?|ltda\.?|me|epp|ip)$/i;

function isDocument(s: string): boolean {
  const t = s.trim();
  return CPF_MASKED_RE.test(t) || CPF_FULL_RE.test(t) || CNPJ_RE.test(t);
}

function titleCase(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => {
      if (i > 0 && LOWERCASE_WORDS.test(w)) return w;
      const cleaned = w.replace(/[.,]+$/, "");
      const punct = w.slice(cleaned.length);
      if (cleaned.length === 0) return w;
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1) + punct;
    })
    .join(" ");
}

const STOP_WORDS_RE =
  /^(de|da|do|das|dos|e|para|a|com|em|na|no|nas|nos|s\.?a\.?|ltda\.?|me|epp|ip|inc|llc|ltd|cia|coop|sa)$/i;

function shortName(name: string, isCompany: boolean): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return parts.join(" ");

  if (isCompany) {
    const significant = parts.filter((p) => !STOP_WORDS_RE.test(p));
    if (significant.length >= 2) return `${significant[0]} ${significant[1]}`;
    if (significant.length === 1) return significant[0];
    return `${parts[0]} ${parts[1]}`;
  }

  return `${parts[0]} ${parts[parts.length - 1]}`;
}

const PJ_HINT_RE =
  /\b(ltda\.?|s\.?a\.?|m\.?e\.?|epp|ip|inc\.?|llc\.?|ltd\.?|cia\.?|coop\.?|servi[çc]os|fintech|pagamentos|company|corp\.?|corporation|hospital|cl[íi]nicas?|igreja|uni[ãa]o|associa[çc][ãa]o|cooperativa|funda[çc][ãa]o)\b/i;

function isPJ(doc: string | null, name: string | null): boolean {
  if (doc != null && CNPJ_RE.test(doc)) return true;
  if (name && PJ_HINT_RE.test(name)) return true;
  return false;
}

function parseBankSegment(seg: string): {
  bank: string | null;
  branch: string | null;
  account: string | null;
} {
  const re =
    /^(.+?)(?:\s+Ag[êe]ncia:\s*([\w-]+))?(?:\s+Conta:\s*([\w-]+))?$/i;
  const m = seg.trim().match(re);
  if (!m) return { bank: seg.trim(), branch: null, account: null };
  let bank = (m[1] ?? "").replace(/^BCO\s+/i, "").trim();
  bank = bank.replace(/\s*-\s*$/, "").trim();
  return {
    bank: bank || null,
    branch: m[2] ?? null,
    account: m[3] ?? null,
  };
}

function emptyParse(raw: string): ParsedDescription {
  return {
    cleanDescription: raw.length > 80 ? raw.slice(0, 77) + "…" : raw,
    paymentMethod: null,
    direction: null,
    counterpartyName: null,
    counterpartyDocument: null,
    counterpartyBank: null,
    counterpartyBranch: null,
    counterpartyAccount: null,
  };
}

function parseTransferLikeRest(rest: string) {
  const segments = rest.split(/\s+-\s+/);

  // Pattern simples: "NOME (Transferência X)"
  const internalMatch = rest.match(
    /^(.+?)\s*\(Transfer[êe]ncia\s+(?:recebida|enviada)\)$/i,
  );
  if (internalMatch) {
    return {
      name: titleCase(internalMatch[1].trim()),
      doc: null as string | null,
      bank: null as string | null,
      branch: null as string | null,
      account: null as string | null,
    };
  }

  const name = segments[0] ? titleCase(segments[0].trim()) : "";
  let docIdx = -1;
  let doc: string | null = null;
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i].trim();
    if (isDocument(seg)) {
      doc = seg;
      docIdx = i;
      break;
    }
  }

  const bankStart = doc != null ? docIdx + 1 : 1;
  const bankRaw = segments.slice(bankStart).join(" - ").trim();
  const bankParsed = bankRaw
    ? parseBankSegment(bankRaw)
    : { bank: null, branch: null, account: null };

  return {
    name,
    doc,
    bank: bankParsed.bank,
    branch: bankParsed.branch,
    account: bankParsed.account,
  };
}

export function parseDescription(raw: string): ParsedDescription {
  const trimmed = raw.trim();
  if (!trimmed) return emptyParse(raw);

  // Pix com prefix
  const pix = trimmed.match(PIX_PREFIX_RE);
  if (pix) {
    const direction = pix[1].toLowerCase() === "recebida" ? "in" : "out";
    const parts = parseTransferLikeRest(pix[2]);
    const display = parts.name
      ? `Pix ${direction === "in" ? "de" : "para"} ${shortName(parts.name, isPJ(parts.doc, parts.name))}`
      : direction === "in"
        ? "Pix recebido"
        : "Pix enviado";
    return {
      cleanDescription: display,
      paymentMethod: "pix",
      direction,
      counterpartyName: parts.name || null,
      counterpartyDocument: parts.doc,
      counterpartyBank: parts.bank,
      counterpartyBranch: parts.branch,
      counterpartyAccount: parts.account,
    };
  }

  // Transferência (não-Pix)
  const tr = trimmed.match(TRANSFER_PREFIX_RE);
  if (tr) {
    const direction = tr[1].toLowerCase() === "recebida" ? "in" : "out";
    const parts = parseTransferLikeRest(tr[2]);
    const display = parts.name
      ? `Transferência ${direction === "in" ? "de" : "para"} ${shortName(parts.name, isPJ(parts.doc, parts.name))}`
      : direction === "in"
        ? "Transferência recebida"
        : "Transferência enviada";
    return {
      cleanDescription: display,
      paymentMethod: "transfer",
      direction,
      counterpartyName: parts.name || null,
      counterpartyDocument: parts.doc,
      counterpartyBank: parts.bank,
      counterpartyBranch: parts.branch,
      counterpartyAccount: parts.account,
    };
  }

  if (FATURA_RE.test(trimmed)) {
    return {
      cleanDescription: "Pagamento de fatura",
      paymentMethod: "fatura_cartao",
      direction: "out",
      counterpartyName: null,
      counterpartyDocument: null,
      counterpartyBank: null,
      counterpartyBranch: null,
      counterpartyAccount: null,
    };
  }

  const boleto = trimmed.match(BOLETO_RE);
  if (boleto) {
    const beneficiary = boleto[1] ? titleCase(boleto[1].trim()) : null;
    return {
      cleanDescription: beneficiary
        ? `Boleto · ${shortName(beneficiary, true)}`
        : "Pagamento de boleto",
      paymentMethod: "boleto",
      direction: "out",
      counterpartyName: beneficiary,
      counterpartyDocument: null,
      counterpartyBank: null,
      counterpartyBranch: null,
      counterpartyAccount: null,
    };
  }

  if (CREDITO_CONTA_RE.test(trimmed)) {
    return {
      cleanDescription: "Crédito em conta",
      paymentMethod: "other",
      direction: "in",
      counterpartyName: null,
      counterpartyDocument: null,
      counterpartyBank: null,
      counterpartyBranch: null,
      counterpartyAccount: null,
    };
  }

  if (RENDIMENTO_RE.test(trimmed)) {
    return {
      cleanDescription: "Rendimento",
      paymentMethod: "yield",
      direction: "in",
      counterpartyName: null,
      counterpartyDocument: null,
      counterpartyBank: null,
      counterpartyBranch: null,
      counterpartyAccount: null,
    };
  }

  if (SALARIO_RE.test(trimmed)) {
    return {
      cleanDescription: "Salário",
      paymentMethod: "salary",
      direction: "in",
      counterpartyName: null,
      counterpartyDocument: null,
      counterpartyBank: null,
      counterpartyBranch: null,
      counterpartyAccount: null,
    };
  }

  return emptyParse(trimmed);
}
