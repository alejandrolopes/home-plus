import "server-only";

export type HoleriteSource = "contracheque" | "ajuda_custo";

export type HoleriteLine = {
  code: string;
  description: string;
  amount: string;
  kind: "income" | "expense";
};

export type ParsedHolerite = {
  source: HoleriteSource;
  liquido: string;
  totalProventos: string;
  totalDescontos: string;
  depositDate: string | null;
  periodMonth: string | null;
  lines: HoleriteLine[];
};

type PdfTextItem = {
  str: string;
  transform: number[];
};

async function extractLines(buffer: Buffer): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;

  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as PdfTextItem[]).filter((it) => "str" in it);
    const byLine = new Map<number, Array<{ x: number; str: string }>>();
    for (const it of items) {
      if (!it.str.trim()) continue;
      const y = Math.round(it.transform[5] * 2) / 2;
      const x = it.transform[4];
      if (!byLine.has(y)) byLine.set(y, []);
      byLine.get(y)!.push({ x, str: it.str });
    }
    const ys = Array.from(byLine.keys()).sort((a, b) => b - a);
    for (const y of ys) {
      const parts = byLine.get(y)!.sort((a, b) => a.x - b.x);
      const text = parts
        .map((r) => r.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) out.push(text);
    }
  }
  return out;
}

function brToNumber(raw: string): number | null {
  const cleaned = raw.replace(/\./g, "").replace(",", ".").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

function isProventoCode(code: string): boolean {
  const num = parseInt(code, 10);
  if (Number.isNaN(num)) return false;
  if (num >= 40000 && num < 45000) return true;
  if (num >= 70000 && num < 75000) return true;
  if (num >= 80000 && num < 85000) return true;
  return false;
}

function isDescontoCode(code: string): boolean {
  const num = parseInt(code, 10);
  if (Number.isNaN(num)) return false;
  if (num >= 45000 && num < 70000) return true;
  if (num >= 75000 && num < 80000) return true;
  return false;
}

const MONTHS_PT: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  março: 3,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

function ddmmyyyyToISO(s: string): string | null {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function lastDayOfMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

function extractPeriodMonth(text: string): string | null {
  // E.g. "Abril / 2026" or "abril/2026"
  const m = text.match(/(\w+)\s*\/\s*(\d{4})/);
  if (!m) return null;
  const monthNum = MONTHS_PT[m[1].toLowerCase()];
  if (!monthNum) return null;
  return `${m[2]}-${String(monthNum).padStart(2, "0")}`;
}

function parseContracheque(lines: string[]): ParsedHolerite {
  const liquidoLine = lines.find((l) => /Valor\s+L[íi]quido/i.test(l));
  let liquido = "0";
  if (liquidoLine) {
    const m = liquidoLine.match(/=>?\s*([\d.,]+)/);
    if (m) liquido = fmt(brToNumber(m[1]) ?? 0);
  }

  const totalsLine = lines.find((l) =>
    /^[\d.,]+\s+[\d.,]+$/.test(l) &&
    !/[A-Za-z]/.test(l),
  );
  let totalProventos = "0";
  let totalDescontos = "0";
  if (totalsLine) {
    const parts = totalsLine.split(/\s+/);
    if (parts.length === 2) {
      totalProventos = fmt(brToNumber(parts[0]) ?? 0);
      totalDescontos = fmt(brToNumber(parts[1]) ?? 0);
    }
  }

  const out: HoleriteLine[] = [];
  const lineRe = /^(\d{5})\s+(.+?)\s+((?:[\d.,]+\s+)?[\d.,]+)\s*$/;
  let inSection = false;
  for (const text of lines) {
    if (/^Cod\.?\s+Descri[çc][ãa]o\s*-\s*Proventos/i.test(text)) {
      inSection = true;
      continue;
    }
    if (
      inSection &&
      (/Total de Proventos/i.test(text) ||
        /^Dep\./i.test(text) ||
        /Outras Bases/i.test(text))
    ) {
      inSection = false;
      continue;
    }
    if (!inSection) continue;

    const m = text.match(lineRe);
    if (!m) continue;
    const code = m[1];
    const desc = m[2].trim();
    const valuesRaw = m[3].split(/\s+/);
    const lastValue = valuesRaw[valuesRaw.length - 1];
    const amount = brToNumber(lastValue);
    if (amount == null || amount <= 0) continue;

    let kind: "income" | "expense";
    if (isProventoCode(code)) kind = "income";
    else if (isDescontoCode(code)) kind = "expense";
    else continue;

    out.push({
      code,
      description: desc,
      amount: fmt(amount),
      kind,
    });
  }

  // Deposit date: "Dep. ... em DD/MM/YYYY"
  let depositDate: string | null = null;
  for (const l of lines) {
    const m = l.match(/em\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (m && /^Dep\./i.test(l)) {
      depositDate = ddmmyyyyToISO(m[1]);
      break;
    }
  }

  // Period
  let periodMonth: string | null = null;
  for (const l of lines) {
    const p = extractPeriodMonth(l);
    if (p) {
      periodMonth = p;
      break;
    }
  }

  return {
    source: "contracheque",
    liquido,
    totalProventos,
    totalDescontos,
    depositDate,
    periodMonth,
    lines: out,
  };
}

function parseAjudaCusto(lines: string[]): ParsedHolerite {
  const liquidoLine = lines.find((l) => /Valor\s+L[íi]quido/i.test(l));
  let liquido = "0";
  if (liquidoLine) {
    const m = liquidoLine.match(/Valor\s+L[íi]quido\s+([\d.,]+)/i);
    if (m) liquido = fmt(brToNumber(m[1]) ?? 0);
  }

  const out: HoleriteLine[] = [];
  // Pattern: code desc declarado descontos reembolsado
  const lineRe =
    /^(\d{5})\s+(.+?)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s*$/;

  let inSection = false;
  for (const text of lines) {
    if (
      /^Cod\.?\s+Descri[çc][ãa]o\s+Declarado\s+Descontos\s+Reembolsado/i.test(
        text,
      )
    ) {
      inSection = true;
      continue;
    }
    if (inSection && /Valor\s+L[íi]quido/i.test(text)) {
      inSection = false;
      continue;
    }
    if (!inSection) continue;

    const m = text.match(lineRe);
    if (!m) continue;
    const code = m[1];
    const desc = m[2].trim();
    const descontos = brToNumber(m[4]) ?? 0;
    const reembolsado = brToNumber(m[5]) ?? 0;

    if (reembolsado > 0) {
      out.push({
        code,
        description: desc,
        amount: fmt(reembolsado),
        kind: "income",
      });
    } else if (descontos > 0) {
      out.push({
        code,
        description: desc,
        amount: fmt(descontos),
        kind: "expense",
      });
    }
  }

  // Totals computed from lines
  const totalProventos = fmt(
    out
      .filter((l) => l.kind === "income")
      .reduce((s, l) => s + Number(l.amount), 0),
  );
  const totalDescontos = fmt(
    out
      .filter((l) => l.kind === "expense")
      .reduce((s, l) => s + Number(l.amount), 0),
  );

  // Period from header
  let periodMonth: string | null = null;
  for (const l of lines) {
    const p = extractPeriodMonth(l);
    if (p) {
      periodMonth = p;
      break;
    }
  }

  // Default deposit date: last day of period month (ajuda de custo doesn't list explicit date)
  let depositDate: string | null = null;
  if (periodMonth) {
    const [yStr, mStr] = periodMonth.split("-");
    const y = Number(yStr);
    const m0 = Number(mStr) - 1;
    const day = lastDayOfMonth(y, m0);
    depositDate = `${periodMonth}-${String(day).padStart(2, "0")}`;
  }

  return {
    source: "ajuda_custo",
    liquido,
    totalProventos,
    totalDescontos,
    depositDate,
    periodMonth,
    lines: out,
  };
}

export async function parseHolerite(buffer: Buffer): Promise<ParsedHolerite> {
  const lines = await extractLines(buffer);
  const flat = lines.join("\n");
  if (/CONTRA-?CHEQUE|Subsist[êe]ncia do Religioso/i.test(flat)) {
    return parseContracheque(lines);
  }
  if (/Extrato\s+Ajuda\s+de\s+Custo|Reembolsado/i.test(flat)) {
    return parseAjudaCusto(lines);
  }
  throw new Error(
    "Tipo de PDF não reconhecido (esperado: contra-cheque ASR ou ajuda de custo)",
  );
}
