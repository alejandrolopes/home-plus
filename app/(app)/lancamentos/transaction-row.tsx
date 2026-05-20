"use client";

import { useState, type CSSProperties } from "react";
import { Check, ChevronDown, ChevronRight, Split } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  flattenForSelect,
  getCategoryDisplayColor,
} from "@/lib/categories-display";
import { formatBRL } from "@/lib/format";
import type {
  SplitChild,
  TransactionRow as TransactionData,
} from "@/lib/repos/transactions";
import { cn } from "@/lib/utils";
import { deleteTransactionAction } from "./actions";
import {
  DeleteButton,
  TransactionFormDialog,
  type EditableTransaction,
} from "./transaction-form";
import { MarkAsCardPrepayDialog } from "./mark-as-prepay-dialog";
import { SplitEditorDialog } from "./split-editor-dialog";
import type { ColumnVisibility } from "./columns";
import type { InlineDraft } from "./transactions-table";

const NONE = "__none__";

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

const dayMonthFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
});

function formatShortDate(iso: string): string {
  return dayMonthFormatter.format(new Date(`${iso}T00:00:00`));
}

const METHOD_LABEL: Record<string, string> = {
  pix: "Pix",
  ted: "TED",
  doc: "DOC",
  boleto: "Boleto",
  fatura_cartao: "Fatura",
  card_invoice_payment: "Pagamento fatura",
  card_prepay: "Antecipação cartão",
  transfer: "Transf.",
  salary: "Salário",
  yield: "Rend.",
  other: "Outro",
};

const METHOD_CLASS: Record<string, string> = {
  pix: "border-violet-300 text-violet-700 dark:text-violet-400",
  boleto: "border-orange-300 text-orange-700 dark:text-orange-400",
  fatura_cartao: "border-sky-300 text-sky-700 dark:text-sky-400",
  card_invoice_payment: "border-sky-300 text-sky-700 dark:text-sky-400",
  card_prepay: "border-sky-300 text-sky-700 dark:text-sky-400",
  transfer: "border-slate-300 text-slate-700 dark:text-slate-400",
  salary: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  yield: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
};

export function TransactionRow({
  transaction,
  splits,
  accounts,
  transferAccounts,
  categories,
  defaultDate,
  show,
  editMode = false,
  draft,
  onDraftChange,
  sumMode = false,
  selected = false,
  onToggleSelected,
  onCategorized,
  tithingEnabled = false,
}: {
  transaction: TransactionData;
  splits: SplitChild[];
  accounts: AccountOption[];
  transferAccounts?: {
    id: string;
    name: string;
    type: "checking" | "savings" | "cash" | "credit_card" | "investment";
    ownerId?: string;
    ownerName?: string;
  }[];
  categories: CategoryOption[];
  defaultDate: string;
  show: ColumnVisibility;
  editMode?: boolean;
  draft?: InlineDraft;
  onDraftChange?: (patch: InlineDraft) => void;
  sumMode?: boolean;
  selected?: boolean;
  onToggleSelected?: () => void;
  onCategorized?: (txId: string) => void;
  tithingEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [markPrepayOpen, setMarkPrepayOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const hasSplits = transaction.splitCount > 0;
  const inlineEditable =
    editMode && transaction.kind !== "transfer" && !hasSplits;
  const canSplit =
    transaction.kind !== "transfer" &&
    !transaction.aggregated &&
    transaction.installmentNumber == null &&
    transaction.account !== null;
  const isEditable =
    transaction.kind !== "transfer" &&
    !transaction.aggregated &&
    transaction.account !== null;
  const stripeColor = transaction.account?.color ?? "transparent";
  const stripeStyle: CSSProperties = { borderLeftColor: stripeColor };

  const catDotColor = (catId: string | undefined, fallback?: string | null) => {
    if (!catId) return fallback ?? "currentColor";
    const cat = categories.find((c) => c.id === catId);
    return (
      (cat ? getCategoryDisplayColor(cat, categories) : null) ??
      fallback ??
      "currentColor"
    );
  };

  const editable: EditableTransaction | null =
    isEditable && transaction.account
      ? {
          id: transaction.id,
          accountId: transaction.account.id,
          accountName: transaction.account.name,
          accountType: transaction.account.type as AccountOption["type"],
          categoryId: transaction.category?.id ?? null,
          kind: transaction.kind as "income" | "expense",
          amount: transaction.amount,
          description: transaction.description,
          cleanDescription: transaction.cleanDescription,
          occurredOn: transaction.purchaseDate ?? transaction.occurredOn,
          notes: transaction.notes,
          isInstallment: transaction.installmentNumber != null,
          isTransfer: transaction.isTransfer,
          isSplitParent: hasSplits,
          isTithable: transaction.isTithable,
        }
      : null;

  const openDialog = () => {
    if (hasSplits) {
      setExpanded((v) => !v);
      return;
    }
    if (editable) setOpen(true);
  };

  const sumSelectable =
    sumMode &&
    transaction.kind !== "transfer" &&
    !!onToggleSelected;
  const rowClickable = (editable && !editMode && !sumMode) || sumSelectable;
  const handleRowClick = sumSelectable
    ? () => onToggleSelected!()
    : editable && !editMode && !sumMode
      ? openDialog
      : undefined;
  const descValue =
    draft?.cleanDescription ??
    (transaction.cleanDescription ?? transaction.description);
  const catValue =
    draft?.categoryId !== undefined
      ? draft.categoryId ?? NONE
      : transaction.category?.id ?? NONE;
  const filteredCats =
    transaction.kind === "income" || transaction.kind === "expense"
      ? flattenForSelect(categories, transaction.kind)
      : [];

  return (
    <>
      <TableRow
        onClick={handleRowClick}
        onKeyDown={
          rowClickable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (sumSelectable) onToggleSelected!();
                  else if (editable && !editMode) setOpen(true);
                }
              }
            : undefined
        }
        role={rowClickable ? "button" : undefined}
        tabIndex={rowClickable ? 0 : undefined}
        aria-label={
          sumSelectable
            ? `${selected ? "Desselecionar" : "Selecionar"} ${transaction.description}`
            : rowClickable
              ? `Editar lançamento ${transaction.description}`
              : undefined
        }
        aria-pressed={sumSelectable ? selected : undefined}
        className={cn(
          "group",
          rowClickable && "cursor-pointer focus-visible:outline-none focus-visible:bg-muted/50",
          selected && "bg-primary/10 hover:bg-primary/15",
        )}
      >
        {show.data ? (
          <TableCell
            className="border-l-[6px] align-middle py-3 tabular-nums text-muted-foreground"
            style={stripeStyle}
          >
            {formatShortDate(transaction.displayDate)}
          </TableCell>
        ) : null}
        <TableCell
          className={`py-3 whitespace-normal align-middle ${show.data ? "" : "border-l-[6px]"}`}
          style={show.data ? undefined : stripeStyle}
        >
          <div className="flex items-center gap-2 flex-wrap">
            {sumMode ? (
              <span
                aria-hidden
                className={cn(
                  "inline-flex items-center justify-center size-4 rounded border shrink-0 transition-colors",
                  selected
                    ? "bg-primary border-primary text-primary-foreground"
                    : "border-muted-foreground/40 group-hover:border-foreground/60",
                  !sumSelectable && "opacity-30",
                )}
              >
                {selected ? <Check className="size-3" /> : null}
              </span>
            ) : null}
            {hasSplits ? (
              <span
                aria-hidden
                className="text-muted-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((v) => !v);
                }}
              >
                {expanded ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
              </span>
            ) : null}
            {inlineEditable ? (
              <Input
                value={descValue}
                onChange={(e) =>
                  onDraftChange?.({
                    cleanDescription:
                      e.target.value === (transaction.cleanDescription ?? transaction.description)
                        ? undefined
                        : e.target.value,
                  })
                }
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "h-7 text-sm w-full max-w-md",
                  draft?.cleanDescription !== undefined &&
                    "border-amber-400 bg-amber-50/40 dark:bg-amber-900/10",
                )}
              />
            ) : (
              <span className="font-medium" title={transaction.description}>
                {transaction.cleanDescription ?? transaction.description}
              </span>
            )}
            {hasSplits ? (
              <Badge
                variant="outline"
                className="text-[10px] border-indigo-300 text-indigo-700 dark:text-indigo-400"
              >
                <Split className="size-2.5" />
                {transaction.splitCount} splits
              </Badge>
            ) : null}
            {transaction.paymentMethod &&
            METHOD_LABEL[transaction.paymentMethod] ? (
              <Badge
                variant="outline"
                className={`text-[10px] ${METHOD_CLASS[transaction.paymentMethod] ?? ""}`}
              >
                {METHOD_LABEL[transaction.paymentMethod]}
              </Badge>
            ) : null}
            {transaction.aggregated ? (
              <Badge variant="secondary" className="text-[10px]">
                {transaction.aggregated.installmentCount}×{" "}
                {formatBRL(transaction.aggregated.perInstallmentAmount)}
              </Badge>
            ) : null}
            {transaction.isPending ? (
              <Badge
                variant="outline"
                className="border-amber-400 text-amber-700 dark:text-amber-500 text-[10px]"
              >
                {transaction.aggregated
                  ? `${transaction.aggregated.pendingCount}/${transaction.aggregated.installmentCount} pendentes`
                  : "pendente"}
              </Badge>
            ) : null}
            {transaction.pendingTransferStatus === "pending" ? (
              <Badge
                variant="outline"
                className="border-amber-400 text-amber-700 dark:text-amber-500 text-[10px]"
                title="Transferência aguardando aceite do outro lado"
              >
                aguarda aceite
              </Badge>
            ) : null}
            {transaction.isTithable ? (
              <span
                aria-label="Dizimável"
                title="Dizimável"
                className="inline-flex items-center justify-center size-4 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 text-[10px] font-semibold"
              >
                D
              </span>
            ) : null}
          </div>
          {inlineEditable &&
          transaction.description &&
          transaction.description !== transaction.cleanDescription ? (
            <div className="mt-1 text-[11px] text-muted-foreground/80 leading-snug">
              <span className="text-muted-foreground/60">Original: </span>
              <span className="font-mono">{transaction.description}</span>
            </div>
          ) : null}
          {transaction.counterpartyBank ? (
            <div className="mt-1 text-xs text-muted-foreground">
              {transaction.counterpartyBank}
            </div>
          ) : null}
          {transaction.paidInvoiceId ? (
            <div className="mt-0.5 text-[11px] text-sky-700 dark:text-sky-400">
              Pagamento de fatura. Some no total apenas na visualização por
              fatura (na visualização por compra, as compras do cartão já
              contam como despesa).
            </div>
          ) : null}
          {transaction.notes ? (
            <div className="mt-0.5 text-xs text-muted-foreground/80">
              {transaction.notes}
            </div>
          ) : null}
        </TableCell>
        {show.categoria ? (
          <TableCell
            className="py-3 align-middle"
            onClick={inlineEditable ? (e) => e.stopPropagation() : undefined}
          >
            {hasSplits ? (
              <span className="text-xs text-muted-foreground italic">
                Múltiplas
              </span>
            ) : inlineEditable ? (
              <Select
                value={catValue}
                onValueChange={(v) => {
                  const next = !v || v === NONE ? null : v;
                  const original = transaction.category?.id ?? null;
                  onDraftChange?.({
                    categoryId: next === original ? undefined : next,
                  });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className={cn(
                    "w-full",
                    draft?.categoryId !== undefined &&
                      "border-amber-400 bg-amber-50/40 dark:bg-amber-900/10",
                  )}
                >
                  <SelectValue>
                    {(v) => {
                      if (!v || v === NONE) return "Sem categoria";
                      return (
                        categories.find((c) => c.id === v)?.name ??
                        "Sem categoria"
                      );
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem categoria</SelectItem>
                  {filteredCats.map((c) => {
                    const dot = getCategoryDisplayColor(c, categories);
                    return (
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
                          {dot ? (
                            <span
                              className="inline-block size-2 rounded-full"
                              style={{ backgroundColor: dot }}
                            />
                          ) : null}
                          {c.name}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            ) : transaction.category ? (
              <span className="inline-flex items-center gap-1.5 text-sm">
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{
                    backgroundColor: catDotColor(
                      transaction.category.id,
                      transaction.category.color,
                    ),
                  }}
                />
                {transaction.category.name}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </TableCell>
        ) : null}
        {show.conta ? (
          <TableCell className="py-3 align-middle">
            {transaction.account ? (
              <AccountChip
                name={transaction.account.name}
                color={transaction.account.color}
                isCard={transaction.account.type === "credit_card"}
              />
            ) : (
              <span className="text-xs text-muted-foreground italic">
                Sem conta
              </span>
            )}
          </TableCell>
        ) : null}
        <TableCell className="text-right tabular-nums font-medium align-middle py-3 text-rose-600">
          {transaction.kind === "expense" ? formatBRL(transaction.amount) : ""}
        </TableCell>
        <TableCell className="relative text-right tabular-nums font-medium align-middle py-3 pr-10 text-emerald-600">
          {transaction.kind === "income" ? formatBRL(transaction.amount) : ""}
          {!editable ? (
            <DeleteButton
              action={deleteTransactionAction}
              ids={transaction.aggregated?.ids ?? [transaction.id]}
              confirmText={
                transaction.aggregated
                  ? `Excluir todas as ${transaction.aggregated.installmentCount} parcelas?`
                  : "Excluir este lançamento?"
              }
              isTransfer={transaction.isTransfer}
              variant="ghost"
              className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            />
          ) : null}
        </TableCell>
      </TableRow>
      {expanded && hasSplits
        ? splits.map((s, idx) => (
            <TableRow
              key={s.id}
              className="bg-muted/30 text-sm"
            >
              {show.data ? (
                <TableCell className="border-l-[6px] py-1.5 align-middle border-l-transparent">
                  {/* empty (parent date already shown) */}
                </TableCell>
              ) : null}
              <TableCell
                className={`py-1.5 align-middle pl-8 ${show.data ? "" : "border-l-[6px] border-l-transparent"}`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-muted-foreground/50">↳</span>
                  <span>{s.description ?? "—"}</span>
                  {s.isTithable ? (
                    <span
                      aria-label="Dizimável"
                      title="Dizimável"
                      className="inline-flex items-center justify-center size-4 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 text-[10px] font-semibold"
                    >
                      D
                    </span>
                  ) : null}
                </span>
              </TableCell>
              {show.categoria ? (
                <TableCell className="py-1.5 align-middle">
                  {s.category ? (
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span
                        aria-hidden
                        className="size-2 rounded-full"
                        style={{
                          backgroundColor: catDotColor(
                            s.category.id,
                            s.category.color,
                          ),
                        }}
                      />
                      {s.category.name}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              ) : null}
              {show.conta ? <TableCell className="py-1.5" /> : null}
              <TableCell className="text-right tabular-nums align-middle py-1.5 text-rose-600">
                {s.kind === "expense" ? formatBRL(s.amount) : ""}
              </TableCell>
              <TableCell className="text-right tabular-nums align-middle py-1.5 pr-10 text-emerald-600">
                {s.kind === "income" ? formatBRL(s.amount) : ""}
                {idx === splits.length - 1 ? (
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden">
                    {/* placeholder for delete on last */}
                  </div>
                ) : null}
              </TableCell>
            </TableRow>
          ))
        : null}
      {expanded && hasSplits ? (
        <TableRow className="bg-muted/30">
          <TableCell
            colSpan={
              1 +
              (show.data ? 1 : 0) +
              (show.conta ? 1 : 0) +
              (show.categoria ? 1 : 0) +
              2
            }
            className="py-2 pr-10 text-right"
          >
            <div className="inline-flex gap-2">
              {editable ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOpen(true)}
                >
                  Editar lançamento
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSplitOpen(true)}
              >
                Editar splits
              </Button>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
      {editable ? (
        <TransactionFormDialog
          open={open}
          onOpenChange={setOpen}
          accounts={accounts}
          transferAccounts={transferAccounts}
          categories={categories}
          defaultDate={defaultDate}
          transaction={editable}
          onRequestSplit={canSplit ? () => setSplitOpen(true) : undefined}
          onRequestMarkAsCardPrepay={
            transaction.kind === "expense" &&
            transaction.account?.type !== "credit_card" &&
            !transaction.installmentNumber &&
            !transaction.isTransfer
              ? () => setMarkPrepayOpen(true)
              : undefined
          }
          onCategorized={onCategorized}
          tithingEnabled={tithingEnabled}
        />
      ) : null}
      <MarkAsCardPrepayDialog
        open={markPrepayOpen}
        onOpenChange={setMarkPrepayOpen}
        transactionId={transaction.id}
        amount={transaction.amount}
      />
      {canSplit && transaction.account ? (
        <SplitEditorDialog
          open={splitOpen}
          onOpenChange={setSplitOpen}
          parent={{
            id: transaction.id,
            description:
              transaction.cleanDescription ?? transaction.description,
            amount: transaction.amount,
            kind: transaction.kind as "income" | "expense",
            occurredOn: transaction.purchaseDate ?? transaction.occurredOn,
            accountName: transaction.account.name,
          }}
          categories={categories}
          existingSplits={splits.map((s) => ({
            id: s.id,
            kind: s.kind,
            categoryId: s.category?.id ?? null,
            description: s.description,
            amount: s.amount,
            isTithable: s.isTithable,
          }))}
          tithingEnabled={tithingEnabled}
        />
      ) : null}
    </>
  );
}

function AccountChip({
  name,
  color,
  isCard,
}: {
  name: string;
  color: string | null;
  isCard: boolean;
}) {
  const dotColor = color ?? "currentColor";
  const style: CSSProperties | undefined = color
    ? {
        backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`,
        borderColor: `color-mix(in oklab, ${color} 40%, transparent)`,
      }
    : undefined;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-xs text-foreground"
      style={style}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ backgroundColor: dotColor }}
      />
      {name}
      {isCard ? <span aria-hidden>💳</span> : null}
    </span>
  );
}
