"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { CategoryPickerDialog } from "@/components/category-picker-dialog";
import { formatBRL, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TransactionFormDialog } from "../lancamentos/transaction-form";
import { CandidateChip } from "./candidate-chip";
import { ReimbursableActionsCell } from "./reimbursable-actions-cell";

export type ReimbursableRowData = {
  id: string;
  occurredOn: string;
  description: string;
  cleanDescription: string | null;
  amount: string;
  status: "pending" | "received";
  kind: "income" | "expense";
  notes: string | null;
  accountId: string | null;
  accountName: string | null;
  accountType: string | null;
  accountColor: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  isInstallment: boolean;
  isTithable: boolean;
};

type AccountOption = {
  id: string;
  name: string;
  type: "checking" | "savings" | "cash" | "credit_card" | "investment";
};

type CategoryOption = {
  id: string;
  name: string;
  kind: "income" | "expense";
  color?: string | null;
  parentId?: string | null;
  isTransfer?: boolean | null;
};

export type IncomeCandidate = {
  id: string;
  occurredOn: string;
  amount: string;
  description: string;
  cleanDescription: string | null;
  accountId: string | null;
  accountName: string | null;
};

type Props = {
  row: ReimbursableRowData;
  candidates?: IncomeCandidate[];
  accounts: AccountOption[];
  categories: CategoryOption[];
  defaultDate: string;
  tithingEnabled: boolean;
};

export function ReimbursableRow({
  row,
  candidates = [],
  accounts,
  categories,
  defaultDate,
  tithingEnabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const editable =
    row.accountId && row.accountType
      ? {
          id: row.id,
          accountId: row.accountId,
          accountName: row.accountName ?? "",
          accountType: row.accountType as AccountOption["type"],
          categoryId: row.categoryId,
          kind: row.kind,
          amount: row.amount,
          description: row.description,
          cleanDescription: row.cleanDescription,
          occurredOn: row.occurredOn,
          notes: row.notes,
          isInstallment: row.isInstallment,
          isTithable: row.isTithable,
          reimbursableStatus: row.status,
        }
      : null;

  const handleRowClick = (e: React.MouseEvent) => {
    // Não abre quando o clique veio dos botões de ação (recebido / desmarcar)
    if ((e.target as HTMLElement).closest("button")) return;
    if (editable) setOpen(true);
  };

  return (
    <>
      <TableRow
        onClick={handleRowClick}
        className={cn(editable && "cursor-pointer hover:bg-muted/50")}
      >
        <TableCell className="tabular-nums text-xs text-muted-foreground">
          {formatDate(`${row.occurredOn}T00:00:00`)}
        </TableCell>
        <TableCell className="text-sm">
          <div>{row.cleanDescription || row.description}</div>
          {row.notes ? (
            <div className="mt-0.5 text-xs text-muted-foreground/80">
              {row.notes}
            </div>
          ) : null}
        </TableCell>
        <TableCell className="text-xs">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPickerOpen(true);
            }}
            className="text-left rounded px-1 -mx-1 hover:bg-muted/60 transition-colors w-full"
            title="Clique pra mudar categoria"
          >
            {row.categoryName ? (
              <span className="inline-flex items-center gap-1.5">
                {row.categoryColor ? (
                  <span
                    aria-hidden
                    className="inline-block size-2 rounded-full"
                    style={{ background: row.categoryColor }}
                  />
                ) : null}
                {row.categoryName}
              </span>
            ) : (
              <span className="text-muted-foreground italic">
                sem categoria
              </span>
            )}
          </button>
        </TableCell>
        <TableCell className="text-xs">
          {row.accountName ? (
            <Badge variant="secondary" className="text-[10px]">
              {row.accountName}
            </Badge>
          ) : null}
        </TableCell>
        <TableCell className="text-right tabular-nums font-medium text-rose-600">
          {formatBRL(row.amount)}
        </TableCell>
        <TableCell className="text-right">
          <div className="flex flex-col items-end gap-1">
            {row.status === "pending" && candidates.length > 0 ? (
              <CandidateChip txId={row.id} candidates={candidates} />
            ) : null}
            <ReimbursableActionsCell txId={row.id} status={row.status} />
          </div>
        </TableCell>
      </TableRow>

      {editable ? (
        <TransactionFormDialog
          open={open}
          onOpenChange={setOpen}
          accounts={accounts}
          categories={categories}
          defaultDate={defaultDate}
          transaction={editable}
          tithingEnabled={tithingEnabled}
        />
      ) : null}
      <CategoryPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        txId={row.id}
        currentCategoryId={row.categoryId}
        currentKind={row.kind}
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          color: c.color,
        }))}
      />
    </>
  );
}
