"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setViewModeAction } from "@/lib/actions";
import type { ViewMode } from "@/lib/preferences";
import { cn } from "@/lib/utils";

type AccountOpt = {
  id: string;
  name: string;
  color?: string | null;
  type?: string;
};
type CategoryOpt = { id: string; name: string; kind: "income" | "expense" };

type Props = {
  accounts: AccountOpt[];
  categories: CategoryOpt[];
  current: {
    from: string;
    to: string;
    accountId?: string;
    categoryId?: string;
    kind?: "income" | "expense";
  };
  view: ViewMode;
};

const ALL = "__all";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function presetRange(preset: string): { from: string; to: string } | null {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (preset) {
    case "this-month":
      return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) };
    case "last-month":
      return {
        from: ymd(new Date(y, m - 1, 1)),
        to: ymd(new Date(y, m, 0)),
      };
    case "next-month":
      return {
        from: ymd(new Date(y, m + 1, 1)),
        to: ymd(new Date(y, m + 2, 0)),
      };
    case "ytd":
      return { from: ymd(new Date(y, 0, 1)), to: ymd(today) };
    case "last-12":
      return {
        from: ymd(new Date(y, m - 11, 1)),
        to: ymd(new Date(y, m + 1, 0)),
      };
    default:
      return null;
  }
}

function detectPreset(from: string, to: string): string {
  for (const p of ["this-month", "last-month", "next-month", "ytd", "last-12"]) {
    const r = presetRange(p);
    if (r && r.from === from && r.to === to) return p;
  }
  return "custom";
}

export function TransactionFilters({
  accounts,
  categories,
  current,
  view,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const preset = detectPreset(current.from, current.to);

  const setView = (next: ViewMode) => {
    if (next === view) return;
    startTransition(() => setViewModeAction(next));
  };

  const apply = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
    });
  };

  const setPreset = (p: string) => {
    const r = presetRange(p);
    if (!r) return;
    apply({ from: r.from, to: r.to });
  };

  const clear = () => {
    startTransition(() => {
      router.push(pathname);
    });
  };

  const hasActiveFilters =
    current.accountId ||
    current.categoryId ||
    current.kind ||
    preset !== "this-month";

  return (
    <div
      data-pending={pending ? "true" : undefined}
      className="rounded-lg border bg-muted/30 p-3 space-y-3 data-[pending=true]:opacity-70 transition-opacity"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1.5">
          <Label htmlFor="filter-period" className="text-xs">
            Período
          </Label>
          <Select value={preset} onValueChange={(v) => v && setPreset(v)}>
            <SelectTrigger id="filter-period" className="w-full">
              <SelectValue>
                {(v) =>
                  ({
                    "this-month": "Mês atual",
                    "last-month": "Mês anterior",
                    "next-month": "Próximo mês",
                    ytd: "Ano até hoje",
                    "last-12": "Últimos 12 meses",
                    custom: "Personalizado",
                  })[v as string] ?? "Período"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="this-month">Mês atual</SelectItem>
              <SelectItem value="last-month">Mês anterior</SelectItem>
              <SelectItem value="next-month">Próximo mês</SelectItem>
              <SelectItem value="ytd">Ano até hoje</SelectItem>
              <SelectItem value="last-12">Últimos 12 meses</SelectItem>
              <SelectItem value="custom" disabled>
                Personalizado (use as datas)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filter-from" className="text-xs">
            De
          </Label>
          <Input
            id="filter-from"
            type="date"
            value={current.from}
            onChange={(e) => apply({ from: e.target.value })}
            className="w-full"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filter-to" className="text-xs">
            Até
          </Label>
          <Input
            id="filter-to"
            type="date"
            value={current.to}
            onChange={(e) => apply({ to: e.target.value })}
            className="w-full"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filter-account" className="text-xs">
            Conta
          </Label>
          <Select
            value={current.accountId ?? ALL}
            onValueChange={(v) =>
              apply({ account: v && v !== ALL ? v : undefined })
            }
          >
            <SelectTrigger id="filter-account" className="w-full">
              <SelectValue>
                {(v) => {
                  if (!v || v === ALL) return "Todas";
                  return accounts.find((a) => a.id === v)?.name ?? "Conta";
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as contas</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filter-category" className="text-xs">
            Categoria
          </Label>
          <Select
            value={current.categoryId ?? ALL}
            onValueChange={(v) =>
              apply({ category: v && v !== ALL ? v : undefined })
            }
          >
            <SelectTrigger id="filter-category" className="w-full">
              <SelectValue>
                {(v) => {
                  if (!v || v === ALL) return "Todas";
                  return (
                    categories.find((c) => c.id === v)?.name ?? "Categoria"
                  );
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as categorias</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1">
          <Button
            type="button"
            variant={!current.kind ? "secondary" : "ghost"}
            size="sm"
            onClick={() => apply({ kind: undefined })}
          >
            Tudo
          </Button>
          <Button
            type="button"
            variant={current.kind === "income" ? "secondary" : "ghost"}
            size="sm"
            onClick={() =>
              apply({ kind: current.kind === "income" ? undefined : "income" })
            }
          >
            Receitas
          </Button>
          <Button
            type="button"
            variant={current.kind === "expense" ? "secondary" : "ghost"}
            size="sm"
            onClick={() =>
              apply({
                kind: current.kind === "expense" ? undefined : "expense",
              })
            }
          >
            Despesas
          </Button>
        </div>

        <div
          role="radiogroup"
          aria-label="Modo de visualização"
          className="ml-auto inline-flex items-center rounded-md border bg-background p-0.5 text-xs"
          title="Por compra: cartão aparece no dia da compra. Por fatura: aparece no fechamento."
        >
          <button
            type="button"
            role="radio"
            aria-checked={view === "purchase"}
            onClick={() => setView("purchase")}
            className={cn(
              "rounded px-2.5 py-1 transition-colors",
              view === "purchase"
                ? "bg-secondary text-secondary-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Por compra
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={view === "invoice"}
            onClick={() => setView("invoice")}
            className={cn(
              "rounded px-2.5 py-1 transition-colors",
              view === "invoice"
                ? "bg-secondary text-secondary-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Por fatura
          </button>
        </div>

        {hasActiveFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clear}
          >
            Limpar filtros
          </Button>
        ) : null}
      </div>
    </div>
  );
}
