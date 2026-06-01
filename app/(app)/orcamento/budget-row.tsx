"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { MoneyInput } from "@/components/ui/money-input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { saveBudgetAction } from "./actions";

export type BudgetRowData = {
  categoryId: string;
  categoryName: string;
  categoryColor: string | null;
  /** "Mãe (Sub)" pra subcategorias; só "Mãe" pra raiz. */
  displayName: string;
  isSub: boolean;
  /** "default" pra editar default, "YYYY-MM" pra editar override do mês. */
  scope: "default" | "month";
  monthKey: string | null; // null quando scope='default'
  /** Valor atual em reais, ex.: "300.00". */
  initialAmount: string;
  /** Valor realizado no mês (só relevante quando scope='month'). */
  spentAmount: string;
  /** Stats dos últimos N meses pra sugestão automática. null se não há histórico. */
  suggestion: {
    avg: string;
    min: string;
    max: string;
    samples: number;
  } | null;
};

export function BudgetRow({ row }: { row: BudgetRowData }) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(row.initialAmount);
  const [savedAmount, setSavedAmount] = useState(row.initialAmount);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("categoryId", row.categoryId);
      fd.set("month", row.scope === "default" ? "default" : (row.monthKey ?? ""));
      fd.set("amount", amount || "0");
      const result = await saveBudgetAction(fd);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setSavedAmount(amount || "0");
      setEditing(false);
    });
  };

  const planned = Number(savedAmount);
  const spent = Number(row.spentAmount);
  const pct = planned > 0 ? Math.min(2, spent / planned) : 0; // cap 200% pra barra
  const pctRender = Math.min(1, pct);
  const overPct = pct > 1 ? Math.round((pct - 1) * 100) : 0;
  const barColor =
    pct === 0
      ? "bg-muted"
      : pct < 0.7
        ? "bg-emerald-500"
        : pct < 1
          ? "bg-amber-500"
          : "bg-rose-500";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 py-2 px-3 rounded-md",
        row.isSub && "pl-9 bg-muted/30",
      )}
    >
      <div className="flex items-center gap-2 min-w-[160px] flex-1">
        {row.categoryColor ? (
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-full shrink-0"
            style={{ backgroundColor: row.categoryColor }}
          />
        ) : null}
        <span
          className={cn(
            "text-sm truncate",
            row.isSub && "text-muted-foreground",
          )}
        >
          {row.displayName}
        </span>
      </div>

      <div className="flex items-center gap-1 w-[220px]">
        {editing ? (
          <>
            <MoneyInput
              value={amount}
              onValueChange={(v) => setAmount(v)}
              className="h-7 text-xs"
              autoFocus
            />
            {row.suggestion ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                title={`Média 6m: ${formatBRL(row.suggestion.avg)} (min ${formatBRL(row.suggestion.min)} · max ${formatBRL(row.suggestion.max)} · ${row.suggestion.samples} mes${row.suggestion.samples > 1 ? "es" : ""})`}
                onClick={() => setAmount(row.suggestion!.avg)}
                className="h-7 px-2 text-xs gap-1"
              >
                <Sparkles className="size-3" />
                {formatBRL(row.suggestion.avg)}
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={save}
              disabled={pending}
              className="h-7 px-2 text-xs"
            >
              {pending ? "..." : "OK"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setAmount(savedAmount);
                setError(null);
              }}
              className="h-7 px-2 text-xs"
            >
              ✕
            </Button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs tabular-nums px-2 py-1 rounded hover:bg-muted/60 transition-colors flex-1 text-right"
            title="Clique para editar"
          >
            {planned > 0 ? formatBRL(savedAmount) : "—"}
          </button>
        )}
      </div>

      {row.scope === "month" ? (
        <>
          <div className="w-[140px] text-right text-xs tabular-nums">
            {spent > 0 ? formatBRL(row.spentAmount) : "—"}
          </div>
          <div className="flex-1 min-w-[120px] flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full ${barColor} transition-all`}
                style={{ width: `${pctRender * 100}%` }}
              />
            </div>
            <span className="text-xs tabular-nums w-[60px] text-right">
              {planned > 0 ? `${Math.round(pct * 100)}%` : "—"}
            </span>
          </div>
          {overPct > 0 ? (
            <Badge variant="outline" className="border-rose-300 text-rose-700 text-[10px]">
              +{overPct}%
            </Badge>
          ) : null}
        </>
      ) : null}

      {error ? (
        <span className="text-xs text-destructive basis-full">{error}</span>
      ) : null}
    </div>
  );
}
