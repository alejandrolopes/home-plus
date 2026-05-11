"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL } from "@/lib/format";

type Period = "current" | "previous" | "ytd";

type PeriodData = {
  base: string;
};

type Props = {
  tithingPct: string;
  pactOfferingPct: string;
  current: PeriodData;
  previous: PeriodData;
  ytd: PeriodData;
};

const PERIOD_LABEL: Record<Period, string> = {
  current: "Mês atual",
  previous: "Mês passado",
  ytd: "Ano até hoje",
};

function multiply(amount: string, pct: string): string {
  const a = Math.round(Number(amount) * 100);
  const p = Number(pct);
  if (!Number.isFinite(a) || !Number.isFinite(p)) return "0";
  const cents = Math.round((a * p) / 100);
  return (cents / 100).toFixed(2);
}

export function FidelidadeCard({
  tithingPct,
  pactOfferingPct,
  current,
  previous,
  ytd,
}: Props) {
  const [period, setPeriod] = useState<Period>("current");
  const data = period === "current" ? current : period === "previous" ? previous : ytd;
  const base = data.base;
  const tithe = multiply(base, tithingPct);
  const pact = multiply(base, pactOfferingPct);
  const baseCents = Math.round(Number(base) * 100);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
        <div>
          <CardTitle className="text-base">Fidelidade</CardTitle>
          <p className="text-xs text-muted-foreground">
            Base dizimável e valores estimados.
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="Período"
          className="inline-flex rounded-md border bg-muted p-0.5 text-xs"
        >
          {(["current", "previous", "ytd"] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={period === p}
              onClick={() => setPeriod(p)}
              className={`px-2 py-1 rounded-sm transition-colors ${
                period === p
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {baseCents === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            Nenhuma receita marcada como dizimável neste período. Marque a
            opção "Dizimável" nos lançamentos de receita ou nas filhas de
            split.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">
                Base dizimável
              </div>
              <div className="text-2xl tabular-nums font-semibold mt-0.5">
                {formatBRL(base)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Σ receitas marcadas
              </div>
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-900/10 p-3">
              <div className="text-xs text-amber-800 dark:text-amber-400">
                Dízimo estimado
              </div>
              <div className="text-2xl tabular-nums font-semibold text-amber-700 dark:text-amber-300 mt-0.5">
                {formatBRL(tithe)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {tithingPct.replace(".", ",")}% × base
              </div>
            </div>
            <div className="rounded-md border border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-900/10 p-3">
              <div className="text-xs text-emerald-800 dark:text-emerald-400">
                Oferta pacto estimada
              </div>
              <div className="text-2xl tabular-nums font-semibold text-emerald-700 dark:text-emerald-300 mt-0.5">
                {formatBRL(pact)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {pactOfferingPct.replace(".", ",")}% × base
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
