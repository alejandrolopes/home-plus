import "server-only";

import { cache } from "react";

export type BcbIndicator = {
  /** Valor numérico (ex.: 10.50 pra 10,50% a.a. ou 4.23 pra inflação 12m). */
  value: number;
  /** Data da observação (dd/mm/yyyy, do jeito que o BCB retorna). */
  date: string;
};

export type BcbIndicators = {
  selic: BcbIndicator | null;
  cdi: BcbIndicator | null;
  ipca12m: BcbIndicator | null;
};

/**
 * Códigos da série SGS (Sistema Gerenciador de Séries Temporais) do BCB:
 *   432  = Selic-meta % a.a. (definida pelo Copom)
 *   4389 = CDI anualizado base 252 % a.a.
 *  13522 = IPCA acumulado em 12 meses (%)
 *
 * API pública: https://api.bcb.gov.br/dados/serie/bcdata.sgs.{code}/dados/ultimos/{n}?formato=json
 * Sem autenticação, sem rate limit estrito. Cacheamos pra reduzir hits e
 * sobreviver a indisponibilidade temporária.
 */
const SERIES = {
  selic: 432,
  cdi: 4389,
  ipca12m: 13522,
} as const;

async function fetchSerie(code: number): Promise<BcbIndicator | null> {
  try {
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados/ultimos/1?formato=json`;
    // Cacheia por 6h. ISR via `next: { revalidate }` no fetch.
    const res = await fetch(url, {
      next: { revalidate: 6 * 60 * 60 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Array<{ data?: string; valor?: string }>;
    const row = Array.isArray(json) ? json[0] : null;
    if (!row?.valor || !row?.data) return null;
    const value = Number(row.valor.replace(",", "."));
    if (!Number.isFinite(value)) return null;
    return { value, date: row.data };
  } catch {
    return null;
  }
}

export const fetchBcbIndicators = cache(async function (): Promise<BcbIndicators> {
  const [selic, cdi, ipca12m] = await Promise.all([
    fetchSerie(SERIES.selic),
    fetchSerie(SERIES.cdi),
    fetchSerie(SERIES.ipca12m),
  ]);
  return { selic, cdi, ipca12m };
});
