"use client";

import { useState } from "react";
import { Filter, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MonthQuickNav } from "./month-quick-nav";
import { TransactionFilters } from "./transaction-filters";
import { TransactionFormDialog } from "./transaction-form";
import type { ViewMode } from "@/lib/preferences";

type AccountOption = {
  id: string;
  name: string;
  type: "checking" | "savings" | "cash" | "credit_card" | "investment";
  color?: string | null;
  bankName?: string | null;
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

type Current = {
  from: string;
  to: string;
  accountId?: string;
  categoryId?: string;
  kind?: "income" | "expense";
};

function countActiveFilters(c: Current): number {
  let n = 0;
  if (c.accountId) n++;
  if (c.categoryId) n++;
  if (c.kind) n++;
  return n;
}

export function LancamentosToolbar({
  transactionsCount,
  accounts,
  transferAccounts,
  categories,
  current,
  view,
  defaultDate,
  tithingEnabled,
}: {
  transactionsCount: number;
  accounts: AccountOption[];
  transferAccounts?: TransferAccountOption[];
  categories: CategoryOption[];
  current: Current;
  view: ViewMode;
  defaultDate: string;
  tithingEnabled?: boolean;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeCount = countActiveFilters(current);
  const filtersHighlighted = filtersOpen || activeCount > 0;

  return (
    <>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Lançamentos</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <MonthQuickNav from={current.from} to={current.to} />
            <span className="text-xs text-muted-foreground">
              {transactionsCount} registro
              {transactionsCount === 1 ? "" : "s"}
            </span>
            <Button
              type="button"
              variant={filtersHighlighted ? "secondary" : "outline"}
              size="sm"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              aria-controls="lancamentos-filters"
            >
              <Filter className="size-3.5" />
              Filtros
              {activeCount > 0 ? (
                <span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-primary/15 text-primary text-[10px] font-semibold min-w-[1.25rem] h-4 px-1">
                  {activeCount}
                </span>
              ) : null}
            </Button>
          </div>
        </div>
        <TransactionFormDialog
          trigger={
            <Button>
              <Plus className="size-4" />
              Novo lançamento
            </Button>
          }
          accounts={accounts.map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
          }))}
          transferAccounts={transferAccounts}
          categories={categories}
          defaultDate={defaultDate}
          tithingEnabled={tithingEnabled}
        />
      </div>

      {filtersOpen ? (
        <div id="lancamentos-filters">
          <TransactionFilters
            accounts={accounts.map((a) => ({
              id: a.id,
              name: a.name,
              color: a.color,
              type: a.type,
            }))}
            categories={categories.map((c) => ({
              id: c.id,
              name: c.name,
              kind: c.kind,
            }))}
            current={current}
            view={view}
          />
        </div>
      ) : null}
    </>
  );
}
