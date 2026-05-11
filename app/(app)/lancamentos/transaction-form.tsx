"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { useActionState } from "react";
import { ArrowLeftRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { flattenForSelect } from "@/lib/categories-display";
import { cn } from "@/lib/utils";
import {
  QuickCategoryDialog,
  type QuickCategoryResult,
} from "../categorias/quick-category-dialog";
import {
  deleteTransactionAction,
  saveTransactionAction,
  type TransactionFormState,
} from "./actions";

type AccountOption = {
  id: string;
  name: string;
  type: "checking" | "savings" | "cash" | "credit_card" | "investment";
};

type TransferAccountOption = AccountOption & {
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

export type EditableTransaction = {
  id: string;
  accountId: string;
  accountName: string;
  accountType: AccountOption["type"];
  categoryId: string | null;
  kind: "income" | "expense";
  amount: string;
  description: string;
  cleanDescription: string | null;
  occurredOn: string;
  notes: string | null;
  isInstallment: boolean;
  isTransfer?: boolean;
  isSplitParent?: boolean;
  isTithable?: boolean;
};

type Props = {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  accounts: AccountOption[];
  /** Contas disponíveis como destino de transferência (família inteira). Default = accounts. */
  transferAccounts?: TransferAccountOption[];
  categories: CategoryOption[];
  defaultDate: string;
  transaction?: EditableTransaction;
  onRequestSplit?: () => void;
  onRequestMarkAsCardPrepay?: () => void;
  tithingEnabled?: boolean;
};

const NONE = "none";
const NEW_CATEGORY = "__new_category__";

export function TransactionFormDialog({
  trigger,
  open: openProp,
  onOpenChange,
  accounts,
  transferAccounts,
  categories,
  defaultDate,
  transaction,
  onRequestSplit,
  onRequestMarkAsCardPrepay,
  tithingEnabled = false,
}: Props) {
  const isEdit = !!transaction;
  const formId = useId();
  const isControlled = openProp !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? openProp : internalOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const [kind, setKind] = useState<"income" | "expense">(
    transaction?.kind ?? "expense",
  );
  const [isTithable, setIsTithable] = useState<boolean>(
    transaction?.isTithable ?? false,
  );
  const [accountId, setAccountId] = useState<string>(
    transaction?.accountId ?? accounts[0]?.id ?? "",
  );
  const [categoryId, setCategoryId] = useState<string>(
    transaction?.categoryId ?? NONE,
  );
  const [extraCategories, setExtraCategories] = useState<CategoryOption[]>([]);
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [state, action, pending] = useActionState<
    TransactionFormState,
    FormData
  >(saveTransactionAction, null);

  useEffect(() => {
    if (state?.success) setOpen(false);
  }, [state]);

  useEffect(() => {
    if (open) {
      setKind(transaction?.kind ?? "expense");
      setAccountId(transaction?.accountId ?? accounts[0]?.id ?? "");
      setCategoryId(transaction?.categoryId ?? NONE);
      setExtraCategories([]);
      setIsTithable(transaction?.isTithable ?? false);
    }
  }, [open, accounts, transaction]);

  const allCategories = useMemo(() => {
    const seen = new Set(categories.map((c) => c.id));
    const extras = extraCategories.filter((c) => !seen.has(c.id));
    return [...categories, ...extras];
  }, [categories, extraCategories]);

  const errors = state?.fieldErrors ?? {};
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const accountType = isEdit
    ? transaction!.accountType
    : selectedAccount?.type;
  const isCard = accountType === "credit_card";
  const filteredCategories = flattenForSelect(allCategories, kind);
  const isSplitParent = isEdit && !!transaction!.isSplitParent;
  const lockAmount =
    isEdit &&
    (transaction!.isInstallment || isSplitParent || !!transaction!.isTransfer);
  const lockDate = isEdit && (isCard || !!transaction?.isTransfer);
  const lockCategory = isSplitParent;
  const lockAccount =
    isEdit &&
    (transaction!.isInstallment || isCard || !!transaction!.isTransfer);
  const selectedCategory =
    categoryId && categoryId !== NONE
      ? allCategories.find((c) => c.id === categoryId)
      : undefined;
  const isTransferMode = !!selectedCategory?.isTransfer;
  const transferPool: TransferAccountOption[] = transferAccounts ?? accounts;
  const otherAccounts = useMemo(
    () =>
      transferPool.filter(
        (a) => a.id !== accountId && a.type !== "credit_card",
      ),
    [transferPool, accountId],
  );
  const otherAccountsByOwner = useMemo(() => {
    const groups = new Map<string, { ownerName: string; items: TransferAccountOption[] }>();
    for (const a of otherAccounts) {
      const key = a.ownerId ?? "self";
      const ownerName = a.ownerName ?? "Minhas contas";
      const g = groups.get(key);
      if (g) g.items.push(a);
      else groups.set(key, { ownerName, items: [a] });
    }
    return Array.from(groups.values());
  }, [otherAccounts]);
  const [transferToAccountId, setTransferToAccountId] = useState<string>("");
  useEffect(() => {
    if (!isTransferMode) {
      setTransferToAccountId("");
      return;
    }
    setTransferToAccountId((cur) => {
      if (cur && cur !== accountId && otherAccounts.some((a) => a.id === cur))
        return cur;
      return otherAccounts[0]?.id ?? "";
    });
  }, [isTransferMode, accountId, otherAccounts]);

  const handleCategoryCreated = (newCat: QuickCategoryResult) => {
    setExtraCategories((prev) => [
      ...prev,
      {
        id: newCat.id,
        name: newCat.name,
        kind: newCat.kind,
        color: newCat.color,
        parentId: newCat.parentId ?? null,
      },
    ]);
    setCategoryId(newCat.id);
    setNewCategoryOpen(false);
  };

  if (accounts.length === 0 && !isEdit) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        {trigger ? (
          <DialogTrigger render={trigger as React.ReactElement} />
        ) : null}
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nenhuma conta cadastrada</DialogTitle>
            <DialogDescription>
              Cadastre uma conta antes de registrar lançamentos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Entendi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger render={trigger as React.ReactElement} />
      ) : null}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar lançamento" : "Novo lançamento"}
          </DialogTitle>
          {isEdit && lockDate ? (
            <DialogDescription>
              Em cartão de crédito, conta e data ficam fixas. Para mover, exclua
              e crie de novo.
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {isEdit && transaction?.isTransfer ? (
          <div className="rounded-md border border-sky-300 bg-sky-50/60 dark:bg-sky-900/20 p-3 text-sm flex items-start gap-2">
            <ArrowLeftRight className="size-4 text-sky-700 dark:text-sky-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-sky-700 dark:text-sky-400">
                Transferência vinculada
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Conta, valor e data ficam travados (a outra ponta seria
                dessincronizada). Você pode editar descrição, categoria,
                observações e marcar como dizimável.
              </p>
            </div>
          </div>
        ) : null}

        <form id={formId} action={action} className="space-y-4">
          {isEdit ? (
            <input type="hidden" name="id" value={transaction!.id} />
          ) : null}

          <KindToggle value={kind} onChange={setKind} disabled={isEdit} />

          <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="description">Descrição</Label>
              <Input
                id="description"
                name={isEdit ? "cleanDescription" : "description"}
                type="text"
                defaultValue={
                  isEdit
                    ? (transaction?.cleanDescription ??
                      transaction?.description ??
                      "")
                    : ""
                }
                placeholder={
                  kind === "income" ? "Ex: Salário" : "Ex: Mercado da semana"
                }
                required
                autoFocus={isEdit}
              />
              {errors.description || errors.cleanDescription ? (
                <p className="text-xs text-destructive">
                  {errors.description ?? errors.cleanDescription}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amount">Valor</Label>
              {lockAmount ? (
                <input
                  type="hidden"
                  name="amount"
                  value={transaction?.amount ?? ""}
                />
              ) : null}
              <MoneyInput
                id="amount"
                name={lockAmount ? undefined : "amount"}
                defaultValue={transaction?.amount ?? ""}
                required={!lockAmount}
                autoFocus={!isEdit}
                disabled={lockAmount}
                className="w-40 text-right tabular-nums"
              />
            </div>
          </div>
          {lockAmount ? (
            <p className="text-xs text-muted-foreground">
              Parcela: valor não pode ser alterado individualmente.
            </p>
          ) : null}
          {errors.amount ? (
            <p className="text-xs text-destructive">{errors.amount}</p>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="accountId">Conta</Label>
              {isEdit && lockAccount ? (
                <>
                  <input
                    type="hidden"
                    name="accountId"
                    value={transaction!.accountId}
                  />
                  <Input
                    id="accountId"
                    value={transaction!.accountName}
                    disabled
                  />
                </>
              ) : (
                <Select
                  name="accountId"
                  value={accountId}
                  onValueChange={(v) => setAccountId(v ?? "")}
                >
                  <SelectTrigger id="accountId" className="w-full">
                    <SelectValue>
                      {(v) => {
                        const acc = accounts.find((a) => a.id === v);
                        if (!acc) return "Selecione";
                        return acc.name;
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {accounts
                      .filter((a) =>
                        // No edit, esconde cartões (transfer/splits/regulares
                        // não funcionam em fatura sem o setup de invoice).
                        isEdit ? a.type !== "credit_card" : true,
                      )
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          <span className="flex items-center gap-2">
                            {a.type === "credit_card" ? (
                              <span aria-hidden>💳</span>
                            ) : null}
                            {a.name}
                          </span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="categoryId">Categoria</Label>
              {lockCategory ? (
                <>
                  <input type="hidden" name="categoryId" value={NONE} />
                  <Input
                    id="categoryId"
                    value="Múltiplas (definidas pelos splits)"
                    disabled
                  />
                </>
              ) : (
              <Select
                name="categoryId"
                value={categoryId}
                onValueChange={(v) => {
                  if (v === NEW_CATEGORY) {
                    setNewCategoryOpen(true);
                    return;
                  }
                  setCategoryId(v ?? NONE);
                }}
              >
                <SelectTrigger id="categoryId" className="w-full">
                  <SelectValue>
                    {(v) => {
                      if (!v || v === NONE) return "Sem categoria";
                      const cat = allCategories.find((c) => c.id === v);
                      return cat?.name ?? "Sem categoria";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem categoria</SelectItem>
                  {filteredCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span
                        className={cn(
                          "flex items-center gap-2",
                          c.depth === 1 && "pl-4",
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
                        {c.color ? (
                          <span
                            className="inline-block size-2.5 rounded-full"
                            style={{ backgroundColor: c.color }}
                          />
                        ) : null}
                        {c.name}
                        {c.isTransfer ? (
                          <ArrowLeftRight className="size-3 text-muted-foreground" />
                        ) : null}
                      </span>
                    </SelectItem>
                  ))}
                  <SelectItem
                    value={NEW_CATEGORY}
                    className="text-primary border-t mt-1 pt-1.5"
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <Plus className="size-3.5" />
                      Nova categoria
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              )}
            </div>
          </div>

          {isTransferMode && (!isEdit || !transaction?.isTransfer) ? (
            <div className="rounded-md border border-sky-300 bg-sky-50/50 dark:bg-sky-900/10 p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs text-sky-700 dark:text-sky-400">
                <ArrowLeftRight className="size-3.5" />
                <span>
                  {isEdit ? "Converter em transferência: " : "Transferência: "}
                  {kind === "expense"
                    ? "saída desta conta com entrada na conta abaixo"
                    : "entrada nesta conta vinda da conta abaixo"}
                  . O sistema cria a perna espelhada e vincula.
                </span>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="transferToAccountId">
                  {kind === "expense" ? "Conta destino" : "Conta origem"}
                </Label>
                <Select
                  value={transferToAccountId}
                  onValueChange={(v) => setTransferToAccountId(v ?? "")}
                >
                  <SelectTrigger id="transferToAccountId" className="w-full">
                    <SelectValue>
                      {(v) => {
                        const acc = otherAccounts.find((a) => a.id === v);
                        if (!acc) return "Selecione a outra conta";
                        return acc.ownerName && acc.ownerName !== "Minhas contas"
                          ? `${acc.name} (${acc.ownerName})`
                          : acc.name;
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {otherAccounts.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        Nenhuma outra conta bancária disponível.
                      </div>
                    ) : null}
                    {otherAccountsByOwner.length > 1
                      ? otherAccountsByOwner.map((group) => (
                          <div key={group.ownerName} className="py-1">
                            <div className="px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                              {group.ownerName}
                            </div>
                            {group.items.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-medium">{a.name}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {a.ownerName ?? "Minhas contas"}
                                  </span>
                                </div>
                              </SelectItem>
                            ))}
                          </div>
                        ))
                      : otherAccounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.ownerName && a.ownerName !== "Minhas contas" ? (
                              <div className="flex flex-col gap-0.5">
                                <span className="font-medium">{a.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  {a.ownerName}
                                </span>
                              </div>
                            ) : (
                              <span>{a.name}</span>
                            )}
                          </SelectItem>
                        ))}
                  </SelectContent>
                </Select>
                <input
                  type="hidden"
                  name="transferToAccountId"
                  value={transferToAccountId}
                />
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="occurredOn">Data</Label>
              {lockDate ? (
                <input
                  type="hidden"
                  name="occurredOn"
                  value={transaction?.occurredOn ?? defaultDate}
                />
              ) : null}
              <Input
                id="occurredOn"
                name={lockDate ? undefined : "occurredOn"}
                type="date"
                defaultValue={transaction?.occurredOn ?? defaultDate}
                required={!lockDate}
                disabled={lockDate}
              />
              {errors.occurredOn ? (
                <p className="text-xs text-destructive">{errors.occurredOn}</p>
              ) : null}
            </div>
            {isCard && !isEdit && !isTransferMode ? (
              <div className="space-y-1.5">
                <Label htmlFor="installments">Parcelas</Label>
                <Input
                  id="installments"
                  name="installments"
                  type="number"
                  min={1}
                  max={48}
                  defaultValue={1}
                />
              </div>
            ) : !isEdit ? (
              <input type="hidden" name="installments" value="1" />
            ) : null}
          </div>
          {isCard && !isEdit && !isTransferMode ? (
            <p className="text-xs text-muted-foreground -mt-2">
              Em cartão, parcelas são distribuídas nas próximas faturas.
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="notes">Observações</Label>
            <Input
              id="notes"
              name="notes"
              type="text"
              defaultValue={transaction?.notes ?? ""}
              placeholder="Opcional"
            />
          </div>

          {tithingEnabled && kind === "income" ? (
            <label className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 cursor-pointer">
              <input
                type="checkbox"
                name="isTithable"
                checked={isTithable}
                onChange={(e) => setIsTithable(e.target.checked)}
                className="size-4 mt-0.5 accent-primary"
              />
              <div className="space-y-0.5">
                <div className="text-sm font-medium">Dizimável</div>
                <p className="text-xs text-muted-foreground">
                  Considerar este valor como base para dízimo e oferta pacto
                  no painel de Fidelidade.
                </p>
              </div>
            </label>
          ) : null}

          {isEdit ? (
            <details className="rounded-md border bg-muted/30 px-3 py-2">
              <summary className="text-sm cursor-pointer text-muted-foreground hover:text-foreground">
                Descrição original (importada)
              </summary>
              <div className="pt-2 space-y-1.5">
                <textarea
                  id="rawDescription"
                  name="description"
                  defaultValue={transaction?.description ?? ""}
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs text-muted-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                />
                <p className="text-xs text-muted-foreground">
                  Texto cru recebido na importação. Editar aqui não muda a
                  descrição que aparece na lista (que é o campo acima).
                </p>
              </div>
            </details>
          ) : null}

          {state?.error && !state.fieldErrors ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}
        </form>

        <DialogFooter className="pt-2">
          {isEdit ? (
            <DeleteButton
              action={deleteTransactionAction}
              ids={[transaction!.id]}
              confirmText="Excluir este lançamento?"
              variant="destructive"
              className="sm:mr-auto"
              isTransfer={!!transaction?.isTransfer}
              onAfterSubmit={() => setOpen(false)}
            />
          ) : null}
          {isEdit && onRequestSplit ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                onRequestSplit();
              }}
            >
              Dividir
            </Button>
          ) : null}
          {isEdit &&
          onRequestMarkAsCardPrepay &&
          transaction?.kind === "expense" &&
          !transaction.isInstallment &&
          !transaction.isTransfer &&
          !transaction.isSplitParent &&
          transaction.accountType !== "credit_card" ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                onRequestMarkAsCardPrepay();
              }}
            >
              Antecipação cartão
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={
              pending ||
              (isTransferMode && !transaction?.isTransfer && !transferToAccountId)
            }
          >
            {pending ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>

        <QuickCategoryDialog
          open={newCategoryOpen}
          onOpenChange={setNewCategoryOpen}
          kind={kind}
          onCreated={handleCategoryCreated}
          parents={allCategories.filter((c) => !c.parentId && !c.isTransfer)}
        />
      </DialogContent>
    </Dialog>
  );
}

function KindToggle({
  value,
  onChange,
  disabled,
}: {
  value: "income" | "expense";
  onChange: (v: "income" | "expense") => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Tipo do lançamento"
      className={cn(
        "inline-flex w-full rounded-lg border bg-muted p-0.5",
        disabled && "opacity-60",
      )}
    >
      <input type="hidden" name="kind" value={value} />
      <ToggleOption
        active={value === "expense"}
        onClick={() => !disabled && onChange("expense")}
        accent="text-rose-600"
        label="Despesa"
        disabled={disabled}
      />
      <ToggleOption
        active={value === "income"}
        onClick={() => !disabled && onChange("income")}
        accent="text-emerald-600"
        label="Receita"
        disabled={disabled}
      />
    </div>
  );
}

function ToggleOption({
  active,
  onClick,
  label,
  accent,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  accent: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? `bg-background shadow-sm ${accent}`
          : "text-muted-foreground hover:text-foreground",
        disabled && "cursor-not-allowed",
      )}
    >
      {label}
    </button>
  );
}

export function DeleteButton({
  action,
  ids,
  label = "Excluir",
  confirmText = "Excluir este lançamento?",
  variant = "ghost",
  size = "sm",
  className,
  isTransfer = false,
  onAfterSubmit,
}: {
  action: (formData: FormData) => void;
  ids: string[];
  label?: string;
  confirmText?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  isTransfer?: boolean;
  onAfterSubmit?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const submit = (mode: "cascade" | "keep_pair") => {
    const fd = new FormData();
    for (const id of ids) fd.append("id", id);
    fd.append("mode", mode);
    startTransition(() => action(fd));
    setConfirmOpen(false);
    onAfterSubmit?.();
  };

  if (isTransfer) {
    return (
      <>
        <Button
          type="button"
          variant={variant}
          size={size}
          disabled={pending}
          className={className}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setConfirmOpen(true);
          }}
        >
          {label}
        </Button>
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Excluir transferência</DialogTitle>
              <DialogDescription>
                Esta linha está pareada com outra conta. Como você quer
                proceder?
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 pt-2">
              <Button
                type="button"
                variant="destructive"
                onClick={() => submit("cascade")}
                disabled={pending}
              >
                Excluir as duas pontas
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => submit("keep_pair")}
                disabled={pending}
              >
                Excluir só esta — manter a outra como lançamento simples
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm(confirmText)) return;
        submit("cascade");
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <Button type="submit" variant={variant} size={size} disabled={pending}>
        {label}
      </Button>
    </form>
  );
}
