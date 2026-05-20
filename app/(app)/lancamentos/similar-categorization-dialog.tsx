"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBRL } from "@/lib/format";
import type { SimilarLookup, SimilarTransaction } from "@/lib/repos/similar-transactions";
import { cn } from "@/lib/utils";
import {
  bulkUpdateInlineAction,
  findSimilarUncategorizedAction,
} from "./actions";

const dayMonthFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
});

function formatShortDate(iso: string): string {
  return dayMonthFormatter.format(new Date(`${iso}T00:00:00`));
}

export function SimilarCategorizationDialog({
  triggerTxId,
  onClose,
}: {
  triggerTxId: string | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [lookup, setLookup] = useState<SimilarLookup | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, startApplying] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const open = triggerTxId !== null;

  useEffect(() => {
    if (!triggerTxId) {
      setLookup(null);
      setSelected(new Set());
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    findSimilarUncategorizedAction(triggerTxId)
      .then((result) => {
        if (cancelled) return;
        setLookup(result);
        setSelected(new Set(result.items.map((it) => it.id)));
      })
      .catch(() => {
        if (cancelled) return;
        setError("Falha ao buscar lançamentos semelhantes.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [triggerTxId]);

  useEffect(() => {
    if (!open) return;
    if (!loading && lookup && lookup.items.length === 0) {
      const t = setTimeout(() => onClose(), 0);
      return () => clearTimeout(t);
    }
  }, [open, loading, lookup, onClose]);

  const items = lookup?.items ?? [];
  const reference = lookup?.reference ?? null;
  const allSelected = items.length > 0 && selected.size === items.length;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((it) => it.id)),
    );
  };

  const apply = () => {
    if (!reference || selected.size === 0) return;
    const ids = items.map((it) => it.id).filter((id) => selected.has(id));
    if (ids.length === 0) return;
    setError(null);
    startApplying(async () => {
      const r = await bulkUpdateInlineAction([
        { ids, categoryId: reference.categoryId },
      ]);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      onClose();
    });
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !applying) onClose();
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Categorizar lançamentos semelhantes</DialogTitle>
          {reference ? (
            <DialogDescription>
              Quer aplicar{" "}
              <CategoryChip
                name={reference.categoryName}
                color={reference.categoryColor}
              />{" "}
              também aos lançamentos abaixo, que estão sem categoria e têm a
              mesma descrição?
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
            <Loader2 className="size-4 animate-spin" />
            <span className="text-sm">Procurando semelhantes…</span>
          </div>
        ) : null}

        {!loading && items.length > 0 ? (
          <SimilarList
            items={items}
            selected={selected}
            onToggle={toggle}
            onToggleAll={toggleAll}
            allSelected={allSelected}
          />
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter className="pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={applying}
          >
            Agora não
          </Button>
          <Button
            type="button"
            onClick={apply}
            disabled={applying || loading || selected.size === 0}
          >
            {applying
              ? "Aplicando…"
              : selected.size > 0
                ? `Aplicar a ${selected.size}`
                : "Aplicar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SimilarList({
  items,
  selected,
  onToggle,
  onToggleAll,
  allSelected,
}: {
  items: SimilarTransaction[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  allSelected: boolean;
}) {
  const totalSelected = useMemo(
    () =>
      items.reduce((sum, it) => {
        if (!selected.has(it.id)) return sum;
        return sum + Math.round(Number(it.amount) * 100);
      }, 0) / 100,
    [items, selected],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onToggleAll}
          className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          {allSelected ? "Desmarcar todos" : "Marcar todos"}
        </button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {selected.size} de {items.length} · {formatBRL(totalSelected.toFixed(2))}
        </span>
      </div>
      <ul className="max-h-72 overflow-y-auto rounded-md border divide-y">
        {items.map((it) => {
          const checked = selected.has(it.id);
          return (
            <li key={it.id}>
              <button
                type="button"
                onClick={() => onToggle(it.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40 transition-colors",
                  checked && "bg-primary/5",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "inline-flex items-center justify-center size-4 rounded border shrink-0 transition-colors",
                    checked
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-muted-foreground/40",
                  )}
                >
                  {checked ? <Check className="size-3" /> : null}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {it.cleanDescription ?? it.description}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap mt-0.5">
                    <span>{formatShortDate(it.occurredOn)}</span>
                    {it.accountName ? (
                      <span className="inline-flex items-center gap-1">
                        <span
                          aria-hidden
                          className="size-1.5 rounded-full"
                          style={{
                            backgroundColor: it.accountColor ?? "currentColor",
                          }}
                        />
                        {it.accountName}
                      </span>
                    ) : null}
                  </div>
                </div>
                <span
                  className={cn(
                    "tabular-nums font-medium shrink-0",
                    it.kind === "expense" ? "text-rose-600" : "text-emerald-600",
                  )}
                >
                  {formatBRL(it.amount)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CategoryChip({
  name,
  color,
}: {
  name: string;
  color: string | null;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-1.5 py-0.5 text-xs font-medium align-middle">
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ backgroundColor: color ?? "currentColor" }}
      />
      {name}
    </span>
  );
}
