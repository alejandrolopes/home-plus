"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { flattenForSelect } from "@/lib/categories-display";
import { formatBRL, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  QuickCategoryDialog,
  type QuickCategoryResult,
} from "../categorias/quick-category-dialog";
import { saveSplitsAction, type SplitInput } from "./split-actions";

type CategoryOption = {
  id: string;
  name: string;
  kind: "income" | "expense";
  parentId?: string | null;
  color?: string | null;
  isTransfer?: boolean | null;
};

type ParentInfo = {
  id: string;
  description: string;
  amount: string;
  kind: "income" | "expense";
  occurredOn: string;
  accountName: string;
};

type ExistingSplit = {
  id: string;
  kind: "income" | "expense";
  categoryId: string | null;
  description: string | null;
  amount: string;
  isTithable?: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parent: ParentInfo;
  categories: CategoryOption[];
  existingSplits: ExistingSplit[];
  tithingEnabled?: boolean;
};

type Row = {
  uid: number;
  kind: "income" | "expense";
  categoryId: string;
  description: string;
  amount: string;
  isTithable: boolean;
};

let nextUid = 1;
function freshUid() {
  return nextUid++;
}

const NONE = "none";
const NEW_CATEGORY = "__new_category__";

function toCents(v: string): number {
  if (!v) return 0;
  const s = v.replace(",", ".").trim();
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function SplitEditorDialog({
  open,
  onOpenChange,
  parent,
  categories,
  existingSplits,
  tithingEnabled = false,
}: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [extraCategories, setExtraCategories] = useState<CategoryOption[]>([]);
  const [newCatRowUid, setNewCatRowUid] = useState<number | null>(null);

  const allCategories = useMemo(() => {
    const seen = new Set(categories.map((c) => c.id));
    return [...categories, ...extraCategories.filter((c) => !seen.has(c.id))];
  }, [categories, extraCategories]);

  const handleCategoryCreated = (cat: QuickCategoryResult) => {
    setExtraCategories((prev) => [...prev, cat]);
    if (newCatRowUid !== null) {
      setRows((prev) =>
        prev.map((r) =>
          r.uid === newCatRowUid ? { ...r, categoryId: cat.id } : r,
        ),
      );
    }
    setNewCatRowUid(null);
  };

  useEffect(() => {
    if (!open) return;
    if (existingSplits.length > 0) {
      setRows(
        existingSplits.map((s) => ({
          uid: freshUid(),
          kind: s.kind,
          categoryId: s.categoryId ?? NONE,
          description: s.description ?? "",
          amount: s.amount.replace(".", ","),
          isTithable: !!s.isTithable,
        })),
      );
    } else {
      setRows([
        {
          uid: freshUid(),
          kind: parent.kind,
          categoryId: NONE,
          description: "",
          amount: parent.amount.replace(".", ","),
          isTithable: false,
        },
      ]);
    }
    setError(null);
  }, [open, existingSplits, parent.kind, parent.amount]);

  const parentCents = toCents(parent.amount);
  const parentSignedCents =
    parent.kind === "income" ? parentCents : -parentCents;

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const r of rows) {
      const c = toCents(r.amount);
      if (r.kind === "income") income += c;
      else expense += c;
    }
    return {
      income,
      expense,
      net: income - expense,
    };
  }, [rows]);

  const diffCents = totals.net - parentSignedCents;
  const isBalanced = Math.abs(diffCents) <= 1;

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        uid: freshUid(),
        kind: parent.kind === "income" ? "expense" : "income",
        categoryId: NONE,
        description: "",
        amount: "0",
        isTithable: false,
      },
    ]);
  };

  const removeRow = (uid: number) => {
    setRows((prev) => prev.filter((r) => r.uid !== uid));
  };

  const updateRow = (uid: number, patch: Partial<Row>) => {
    setRows((prev) =>
      prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)),
    );
  };

  const submit = () => {
    setError(null);
    const items: SplitInput[] = rows.map((r) => ({
      kind: r.kind,
      categoryId: r.categoryId === NONE ? null : r.categoryId,
      description: r.description.trim() || null,
      amount: r.amount.replace(",", "."),
      isTithable: r.kind === "income" && r.isTithable,
    }));
    startTransition(async () => {
      const r = await saveSplitsAction(parent.id, items);
      if ("error" in r) setError(r.error);
      else onOpenChange(false);
    });
  };

  const removeAll = () => {
    if (
      !confirm(
        "Remover todos os splits e reverter pra lançamento simples?",
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const r = await saveSplitsAction(parent.id, []);
      if ("error" in r) setError(r.error);
      else onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Dividir lançamento</DialogTitle>
          <DialogDescription>
            <strong>{parent.description}</strong> ·{" "}
            {formatDate(`${parent.occurredOn}T00:00:00`)} ·{" "}
            {parent.accountName} ·{" "}
            <span className={cn("tabular-nums font-medium",
              parent.kind === "income" ? "text-emerald-600" : "text-rose-600",
            )}>
              {parent.kind === "income" ? "+" : "−"}{formatBRL(parent.amount)}
            </span>
            <br />
            Soma dos splits (proventos − descontos) deve igualar o valor do
            lançamento.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border max-h-[55vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur">
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-2 py-1.5 text-left font-normal w-24">
                  Tipo
                </th>
                <th className="px-2 py-1.5 text-left font-normal">
                  Categoria
                </th>
                <th className="px-2 py-1.5 text-left font-normal">
                  Descrição
                </th>
                <th className="px-2 py-1.5 text-right font-normal w-28">
                  Valor
                </th>
                {tithingEnabled ? (
                  <th
                    className="px-2 py-1.5 text-center font-normal w-12"
                    title="Dizimável"
                  >
                    Diz.
                  </th>
                ) : null}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const filtered = flattenForSelect(
                  allCategories.filter((c) => !c.isTransfer),
                  r.kind,
                );
                return (
                  <tr key={r.uid} className="border-b last:border-0">
                    <td className="px-2 py-1.5">
                      <Select
                        value={r.kind}
                        onValueChange={(v) =>
                          updateRow(r.uid, {
                            kind: (v ?? "expense") as "income" | "expense",
                            categoryId: NONE,
                          })
                        }
                      >
                        <SelectTrigger size="sm" className="w-full">
                          <SelectValue>
                            {(v) =>
                              v === "income" ? "Provento" : "Desconto"
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="income">Provento</SelectItem>
                          <SelectItem value="expense">Desconto</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Select
                        value={r.categoryId}
                        onValueChange={(v) => {
                          if (v === NEW_CATEGORY) {
                            setNewCatRowUid(r.uid);
                            return;
                          }
                          updateRow(r.uid, { categoryId: v ?? NONE });
                        }}
                      >
                        <SelectTrigger size="sm" className="w-full">
                          <SelectValue>
                            {(v) => {
                              if (!v || v === NONE) return "Sem categoria";
                              return (
                                allCategories.find((c) => c.id === v)?.name ??
                                "Sem categoria"
                              );
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Sem categoria</SelectItem>
                          {filtered.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              <span
                                className={cn(
                                  "flex items-center gap-1.5",
                                  c.depth === 1 && "pl-3",
                                )}
                              >
                                {c.depth === 1 ? (
                                  <span
                                    aria-hidden
                                    className="text-muted-foreground/60"
                                  >
                                    ↳
                                  </span>
                                ) : null}
                                {c.name}
                              </span>
                            </SelectItem>
                          ))}
                          <SelectItem value={NEW_CATEGORY}>
                            <span className="inline-flex items-center gap-1.5">
                              <Plus className="size-3.5" />
                              Nova categoria
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        value={r.description}
                        onChange={(e) =>
                          updateRow(r.uid, { description: e.target.value })
                        }
                        placeholder="Ex: INSS, Dízimo, Plano Gama..."
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <MoneyInput
                        value={r.amount || "0"}
                        onValueChange={(v) =>
                          updateRow(r.uid, { amount: v })
                        }
                        className="text-right tabular-nums"
                      />
                    </td>
                    {tithingEnabled ? (
                      <td className="px-2 py-1.5 text-center">
                        {r.kind === "income" ? (
                          <input
                            type="checkbox"
                            checked={r.isTithable}
                            onChange={(e) =>
                              updateRow(r.uid, {
                                isTithable: e.target.checked,
                              })
                            }
                            className="size-4 accent-primary"
                            aria-label="Dizimável"
                            title="Dizimável"
                          />
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                    ) : null}
                    <td className="px-2 py-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeRow(r.uid)}
                        disabled={rows.length === 1}
                        aria-label="Remover linha"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="size-3.5" />
            Adicionar linha
          </Button>

          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              Proventos:{" "}
              <span className="tabular-nums text-emerald-600 font-medium">
                {formatBRL((totals.income / 100).toFixed(2))}
              </span>
            </span>
            <span className="text-muted-foreground">
              Descontos:{" "}
              <span className="tabular-nums text-rose-600 font-medium">
                {formatBRL((totals.expense / 100).toFixed(2))}
              </span>
            </span>
            <span
              className={cn(
                "tabular-nums font-semibold rounded-md px-2 py-0.5",
                isBalanced
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                  : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400",
              )}
            >
              {isBalanced
                ? "🟢 Balanceado"
                : `🔴 Diverge em ${formatBRL((Math.abs(diffCents) / 100).toFixed(2))}`}
            </span>
          </div>
        </div>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}

        <DialogFooter className="justify-between sm:justify-between">
          <div>
            {existingSplits.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={removeAll}
                disabled={pending}
                className="text-destructive"
              >
                Remover todos os splits
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={pending || !isBalanced}
            >
              {pending ? "Salvando..." : "Salvar splits"}
            </Button>
          </div>
        </DialogFooter>

        {newCatRowUid !== null ? (
          <QuickCategoryDialog
            open
            onOpenChange={(o) => {
              if (!o) setNewCatRowUid(null);
            }}
            kind={
              rows.find((r) => r.uid === newCatRowUid)?.kind ?? parent.kind
            }
            onCreated={handleCategoryCreated}
            parents={allCategories.filter((c) => !c.parentId)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
