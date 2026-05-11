"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Pencil, Settings2, Sigma, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  SplitChild,
  TransactionRow as TransactionData,
} from "@/lib/repos/transactions";
import {
  bulkUpdateInlineAction,
  type BulkInlineUpdate,
} from "./actions";
import {
  COLUMN_DEFS,
  DEFAULT_VISIBILITY,
  STORAGE_KEY,
  type ColumnId,
  type ColumnVisibility,
} from "./columns";
import { TransactionRow } from "./transaction-row";

export type InlineDraft = {
  cleanDescription?: string;
  categoryId?: string | null; // null = sem categoria, undefined = sem mudança
};

type AccountOption = {
  id: string;
  name: string;
  type: "checking" | "savings" | "cash" | "credit_card" | "investment";
  color?: string | null;
};

type TransferAccountOption = {
  id: string;
  name: string;
  type: "checking" | "savings" | "cash" | "credit_card" | "investment";
  ownerId?: string;
  ownerName?: string;
};

type CategoryOption = {
  id: string;
  name: string;
  kind: "income" | "expense";
  color?: string | null;
  parentId?: string | null;
  isTransfer?: boolean | null;
};

let cachedSnapshot: ColumnVisibility | null = null;
const listeners = new Set<() => void>();

function readFromStorage(): ColumnVisibility {
  if (typeof window === "undefined") return DEFAULT_VISIBILITY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VISIBILITY;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_VISIBILITY;
    return {
      data: parsed.data ?? DEFAULT_VISIBILITY.data,
      conta: parsed.conta ?? DEFAULT_VISIBILITY.conta,
      categoria: parsed.categoria ?? DEFAULT_VISIBILITY.categoria,
    };
  } catch {
    return DEFAULT_VISIBILITY;
  }
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): ColumnVisibility {
  if (!cachedSnapshot) cachedSnapshot = readFromStorage();
  return cachedSnapshot;
}

function getServerSnapshot(): ColumnVisibility {
  return DEFAULT_VISIBILITY;
}

function setVisibility(next: ColumnVisibility) {
  cachedSnapshot = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
  for (const l of listeners) l();
}

export function TransactionsTable({
  transactions,
  splitsByParent,
  accounts,
  transferAccounts,
  categories,
  defaultDate,
  tithingEnabled,
}: {
  transactions: TransactionData[];
  splitsByParent: Record<string, SplitChild[]>;
  accounts: AccountOption[];
  transferAccounts?: TransferAccountOption[];
  categories: CategoryOption[];
  defaultDate: string;
  tithingEnabled?: boolean;
}) {
  const show = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = (id: ColumnId) => {
    setVisibility({ ...show, [id]: !show[id] });
  };

  const [editMode, setEditMode] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, InlineDraft>>({});
  const [saving, startSaving] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);

  const [sumMode, setSumMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sumTotals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    if (selected.size === 0) return { debit: 0, credit: 0, net: 0 };
    const idIndex = new Map(transactions.map((t) => [t.id, t] as const));
    for (const id of selected) {
      const t = idIndex.get(id);
      if (!t) continue;
      const cents = Math.round(Number(t.amount) * 100);
      if (t.kind === "expense") debit += cents;
      else if (t.kind === "income") credit += cents;
    }
    return {
      debit: debit / 100,
      credit: credit / 100,
      net: (credit - debit) / 100,
    };
  }, [selected, transactions]);

  const exitSum = () => {
    setSumMode(false);
    setSelected(new Set());
  };

  const enterSum = () => {
    if (editMode) {
      // Mutuamente exclusivo: descarta drafts pendentes ao entrar no SUM
      setEditMode(false);
      setDrafts({});
      setSaveError(null);
    }
    setSumMode(true);
  };

  const updateDraft = (id: string, patch: InlineDraft) => {
    setDrafts((prev) => {
      const cur = prev[id] ?? {};
      const next = { ...cur, ...patch };
      // Clean keys with undefined values
      if (next.cleanDescription === undefined) delete next.cleanDescription;
      if (next.categoryId === undefined) delete next.categoryId;
      const out = { ...prev };
      if (Object.keys(next).length === 0) delete out[id];
      else out[id] = next;
      return out;
    });
  };

  const dirtyCount = Object.keys(drafts).length;

  const exitEdit = () => {
    setEditMode(false);
    setDrafts({});
    setSaveError(null);
  };

  const save = () => {
    setSaveError(null);
    const idToTx = new Map(transactions.map((t) => [t.id, t] as const));
    const updates: BulkInlineUpdate[] = [];
    for (const [id, draft] of Object.entries(drafts)) {
      const tx = idToTx.get(id);
      if (!tx) continue;
      const ids = tx.aggregated?.ids ?? [tx.id];
      updates.push({
        ids,
        cleanDescription: draft.cleanDescription,
        categoryId: draft.categoryId,
      });
    }
    startSaving(async () => {
      const r = await bulkUpdateInlineAction(updates);
      if ("error" in r) {
        setSaveError(r.error);
        return;
      }
      exitEdit();
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <AccountFilterChips accounts={accounts} />
          {editMode ? (
            <div className="flex items-center gap-2">
              {dirtyCount > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {dirtyCount} alteração{dirtyCount > 1 ? "s" : ""} pendente
                  {dirtyCount > 1 ? "s" : ""}
                </span>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={exitEdit}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={save}
                disabled={saving || dirtyCount === 0}
              >
                {saving ? "Salvando..." : "Salvar tudo"}
              </Button>
            </div>
          ) : (
            <>
              <Button
                variant={sumMode ? "secondary" : "outline"}
                size="sm"
                onClick={sumMode ? exitSum : enterSum}
                aria-pressed={sumMode}
              >
                <Sigma />
                {sumMode ? "Somando..." : "Somar"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditMode(true)}
                disabled={sumMode}
              >
                <Pencil />
                Editar inline
              </Button>
            </>
          )}
          <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm">
                <Settings2 />
                Colunas
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Colunas visíveis</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {COLUMN_DEFS.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.id}
                  checked={show[c.id]}
                  onCheckedChange={() => toggle(c.id)}
                  closeOnClick={false}
                >
                  {c.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      {saveError ? (
        <p className="text-sm text-destructive">{saveError}</p>
      ) : null}

      {sumMode ? (
        <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium">
            <Sigma className="size-4" />
            Total
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {selected.size} selecionado{selected.size === 1 ? "" : "s"}
          </span>
          <span className="text-xs tabular-nums">
            <span className="text-muted-foreground">Débitos: </span>
            <span className="text-rose-600 font-medium">
              {formatBRL(sumTotals.debit.toFixed(2))}
            </span>
          </span>
          <span className="text-xs tabular-nums">
            <span className="text-muted-foreground">Créditos: </span>
            <span className="text-emerald-600 font-medium">
              {formatBRL(sumTotals.credit.toFixed(2))}
            </span>
          </span>
          <span
            className={cn(
              "text-sm tabular-nums font-semibold rounded-md px-2 py-0.5 ml-auto",
              sumTotals.net >= 0
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400",
            )}
          >
            Saldo: {sumTotals.net >= 0 ? "+" : "−"}
            {formatBRL(Math.abs(sumTotals.net).toFixed(2))}
          </span>
          {selected.size > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
            >
              Limpar
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={exitSum}>
            <X />
            Sair
          </Button>
        </div>
      ) : null}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {show.data ? (
                <TableHead className="w-[88px] pl-4">Data</TableHead>
              ) : null}
              <TableHead>Descrição</TableHead>
              {show.categoria ? <TableHead>Categoria</TableHead> : null}
              {show.conta ? <TableHead>Conta</TableHead> : null}
              <TableHead className="text-right w-[160px]">Débitos</TableHead>
              <TableHead className="text-right pr-10 w-[160px]">
                Créditos
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((t) => (
              <TransactionRow
                key={t.id}
                transaction={t}
                splits={splitsByParent[t.id] ?? []}
                accounts={accounts}
                transferAccounts={transferAccounts}
                categories={categories}
                defaultDate={defaultDate}
                show={show}
                editMode={editMode}
                draft={drafts[t.id]}
                onDraftChange={(patch) => updateDraft(t.id, patch)}
                sumMode={sumMode}
                selected={selected.has(t.id)}
                onToggleSelected={() => toggleSelected(t.id)}
                tithingEnabled={tithingEnabled}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AccountFilterChips({
  accounts,
}: {
  accounts: AccountOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const current = sp.get("account") ?? null;

  if (accounts.length === 0) return null;

  const apply = (next: string | null) => {
    const params = new URLSearchParams(sp.toString());
    if (next) params.set("account", next);
    else params.delete("account");
    startTransition(() => {
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  };

  return (
    <div
      data-pending={pending ? "true" : undefined}
      className="flex flex-wrap items-center gap-1 data-[pending=true]:opacity-70 transition-opacity"
    >
      {accounts.map((a) => {
        const active = current === a.id;
        const accent = a.color ?? "#64748b";
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => apply(active ? null : a.id)}
            title={a.name}
            aria-pressed={active}
            style={
              active
                ? {
                    backgroundColor: accent,
                    borderColor: accent,
                    color: "white",
                  }
                : undefined
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors",
              active
                ? "font-medium shadow-sm"
                : "border-slate-200 bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400 dark:hover:bg-slate-700",
            )}
          >
            {!active ? (
              <span
                aria-hidden
                className="size-2 rounded-full shrink-0"
                style={{ backgroundColor: accent }}
              />
            ) : null}
            <span className="max-w-[140px] truncate">{a.name}</span>
          </button>
        );
      })}
    </div>
  );
}
