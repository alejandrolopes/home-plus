"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL } from "@/lib/format";
import type {
  IncomeCandidate,
  ReimbursementRow,
} from "@/lib/repos/reimbursements";
import { cn } from "@/lib/utils";
import { SettleDialog } from "./settle-dialog";
import { UnsettleButton } from "./unsettle-button";

type AccountOption = {
  id: string;
  name: string;
  type: "checking" | "savings" | "cash" | "credit_card" | "investment";
  color: string | null;
};

const dayMonthFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
});

function fmt(iso: string): string {
  if (!iso) return "";
  return dayMonthFormatter.format(new Date(`${iso}T00:00:00`));
}

export function ReimbursementsTable({
  items,
  tab,
  incomeCandidates,
  accounts,
}: {
  items: ReimbursementRow[];
  tab: "pending" | "reimbursed" | "all";
  incomeCandidates: IncomeCandidate[];
  accounts: AccountOption[];
}) {
  const [settleFor, setSettleFor] = useState<ReimbursementRow | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <TabLink current={tab} value="pending" label="Pendentes" />
        <TabLink current={tab} value="reimbursed" label="Reembolsados" />
        <TabLink current={tab} value="all" label="Todos" />
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {tab === "pending"
            ? "Nenhuma compra aguardando reembolso."
            : tab === "reimbursed"
              ? "Nenhum reembolso registrado ainda."
              : "Nenhum reembolso registrado ainda. Marque uma categoria como reembolsável para começar."}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[90px]">Data</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Pagador / Categoria</TableHead>
                <TableHead>Conta</TableHead>
                <TableHead className="text-right w-[140px]">Valor</TableHead>
                <TableHead className="text-right w-[180px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {fmt(it.expense.occurredOn)}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">
                      {it.expense.cleanDescription ?? it.expense.description}
                    </div>
                    {it.notes ? (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {it.notes}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span>{it.expectedFrom ?? "—"}</span>
                      {it.expense.categoryName ? (
                        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                          <span
                            aria-hidden
                            className="size-1.5 rounded-full"
                            style={{
                              backgroundColor:
                                it.expense.categoryColor ?? "currentColor",
                            }}
                          />
                          {it.expense.categoryName}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    {it.expense.accountName ? (
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <span
                          aria-hidden
                          className="size-1.5 rounded-full"
                          style={{
                            backgroundColor:
                              it.expense.accountColor ?? "currentColor",
                          }}
                        />
                        {it.expense.accountName}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums font-medium",
                      "text-rose-600",
                    )}
                  >
                    {formatBRL(it.expense.amount)}
                  </TableCell>
                  <TableCell className="text-right">
                    {it.status === "pending" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSettleFor(it)}
                      >
                        Marcar reembolsado
                      </Button>
                    ) : (
                      <div className="flex items-center justify-end gap-2 flex-wrap">
                        <Badge
                          variant="outline"
                          className="border-emerald-300 text-emerald-700 dark:text-emerald-400 text-[10px]"
                        >
                          Reembolsado
                          {it.income
                            ? ` · ${fmt(it.income.occurredOn)}`
                            : ""}
                        </Badge>
                        <UnsettleButton reimbursementId={it.id} />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <SettleDialog
        target={settleFor}
        onClose={() => setSettleFor(null)}
        candidates={incomeCandidates}
        accounts={accounts}
      />
    </div>
  );
}

function TabLink({
  current,
  value,
  label,
}: {
  current: "pending" | "reimbursed" | "all";
  value: "pending" | "reimbursed" | "all";
  label: string;
}) {
  const active = current === value;
  return (
    <Link
      href={`/reembolsos?tab=${value}`}
      className={cn(
        "inline-flex items-center px-3 py-1.5 rounded-md text-sm border transition-colors",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-muted/30 text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}
