"use client";

import { useEffect, useState, useTransition } from "react";
import { useActionState } from "react";
import { Calculator } from "lucide-react";
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
import { MoneyInput } from "@/components/ui/money-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  computeInitialBalanceAction,
  getAccountMovementsAction,
  saveAccountAction,
  type AccountFormState,
} from "./actions";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FinancialAccount } from "@/lib/repos/accounts";

type Props = {
  trigger: React.ReactNode;
  account?: FinancialAccount;
};

const TYPE_LABELS: Record<FinancialAccount["type"], string> = {
  checking: "Conta corrente",
  savings: "Poupança",
  cash: "Dinheiro",
  credit_card: "Cartão de crédito",
  investment: "Investimentos (renda fixa)",
};

export function AccountFormDialog({ trigger, account }: Props) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FinancialAccount["type"]>(
    account?.type ?? "checking",
  );
  const [state, action, pending] = useActionState<AccountFormState, FormData>(
    saveAccountAction,
    null,
  );

  useEffect(() => {
    if (state?.success) setOpen(false);
  }, [state]);

  useEffect(() => {
    if (open) setType(account?.type ?? "checking");
  }, [open, account?.type]);

  const isCard = type === "credit_card";
  const errors = state?.fieldErrors ?? {};

  const [initialBalanceValue, setInitialBalanceValue] = useState<string>(
    account?.initialBalance ?? "0",
  );
  const [calibrateOpen, setCalibrateOpen] = useState(false);
  const [calibInput, setCalibInput] = useState("");
  const [calibPending, startCalib] = useTransition();
  const [calibError, setCalibError] = useState<string | null>(null);
  const [movements, setMovements] = useState<{
    income: string;
    expense: string;
    initialBalance: string;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setCalibrateOpen(false);
      setCalibInput("");
      setCalibError(null);
      setMovements(null);
    }
  }, [open]);

  // Carrega movimentos quando o painel de calibração é aberto
  useEffect(() => {
    if (!calibrateOpen || !account) return;
    let cancelled = false;
    (async () => {
      const r = await getAccountMovementsAction(account.id);
      if (!cancelled && !("error" in r)) setMovements(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [calibrateOpen, account]);

  // Cálculo ao vivo do novo saldo inicial
  const calibPreview = (() => {
    if (!movements || !calibInput) return null;
    const cleaned = calibInput.replace(",", ".").trim();
    if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
    const currentCents = Math.round(Number(cleaned) * 100);
    const incomeCents = Math.round(Number(movements.income) * 100);
    const expenseCents = Math.round(Number(movements.expense) * 100);
    const newInitialCents = currentCents - (incomeCents - expenseCents);
    return (newInitialCents / 100).toFixed(2);
  })();

  const currentInitialCents = movements
    ? Math.round(Number(movements.initialBalance) * 100)
    : 0;
  const movementNetCents = movements
    ? Math.round(Number(movements.income) * 100) -
      Math.round(Number(movements.expense) * 100)
    : 0;
  const computedCurrentCents = currentInitialCents + movementNetCents;
  const computedCurrent = (computedCurrentCents / 100).toFixed(2);

  const applyCalibration = () => {
    if (!account) return;
    setCalibError(null);
    startCalib(async () => {
      const r = await computeInitialBalanceAction(account.id, calibInput);
      if ("error" in r) {
        setCalibError(r.error);
        return;
      }
      setInitialBalanceValue(r.newInitial);
      setCalibrateOpen(false);
      setCalibInput("");
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{account ? "Editar conta" : "Nova conta"}</DialogTitle>
          <DialogDescription>
            Cadastre contas correntes, poupança, dinheiro e cartões de crédito.
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="space-y-4">
          {account ? <input type="hidden" name="id" value={account.id} /> : null}

          <div className="space-y-2">
            <Label htmlFor="name">Nome</Label>
            <Input
              id="name"
              name="name"
              defaultValue={account?.name ?? ""}
              required
              autoFocus
            />
            {errors.name ? (
              <p className="text-xs text-destructive">{errors.name}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="type">Tipo</Label>
            <Select
              name="type"
              value={type}
              onValueChange={(v) =>
                setType((v ?? "checking") as FinancialAccount["type"])
              }
            >
              <SelectTrigger id="type">
                <SelectValue>
                  {(v) =>
                    TYPE_LABELS[v as FinancialAccount["type"]] ?? "Selecione"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(
                  Object.keys(TYPE_LABELS) as Array<FinancialAccount["type"]>
                ).map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="initialBalance">Saldo inicial</Label>
              <div className="flex gap-2">
                <MoneyInput
                  id="initialBalance"
                  name="initialBalance"
                  value={initialBalanceValue}
                  onValueChange={setInitialBalanceValue}
                  allowNegative
                  required
                  className="flex-1 text-right tabular-nums"
                />
                {account ? (
                  <Button
                    type="button"
                    variant={calibrateOpen ? "secondary" : "outline"}
                    size="icon"
                    onClick={() => setCalibrateOpen((v) => !v)}
                    title="Calibrar pelo saldo atual"
                    aria-label="Calibrar saldo inicial"
                  >
                    <Calculator className="size-4" />
                  </Button>
                ) : null}
              </div>
              {errors.initialBalance ? (
                <p className="text-xs text-destructive">{errors.initialBalance}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="color">Cor</Label>
              <Input
                id="color"
                name="color"
                type="color"
                defaultValue={account?.color ?? "#64748b"}
                className="w-12 p-1 cursor-pointer"
              />
            </div>
          </div>

          {calibrateOpen && account ? (
            <div className="rounded-md border bg-muted/30 p-3 space-y-3">
              {movements ? (
                <div className="rounded-md bg-background border p-2 space-y-1 text-xs tabular-nums">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Saldo inicial atual
                    </span>
                    <span className="font-medium">
                      {formatBRL(movements.initialBalance)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Entradas (créditos)
                    </span>
                    <span className="text-emerald-600 font-medium">
                      +{formatBRL(movements.income)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Saídas (débitos)
                    </span>
                    <span className="text-rose-600 font-medium">
                      −{formatBRL(movements.expense)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t pt-1 mt-1">
                    <span className="text-muted-foreground">
                      Saldo atual calculado
                    </span>
                    <span
                      className={cn(
                        "font-semibold",
                        computedCurrentCents >= 0
                          ? "text-emerald-600"
                          : "text-rose-600",
                      )}
                    >
                      {formatBRL(computedCurrent)}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Carregando movimentos...
                </p>
              )}
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="calibInput" className="text-xs">
                    Saldo atual no banco
                  </Label>
                  <MoneyInput
                    id="calibInput"
                    value={calibInput || "0"}
                    onValueChange={setCalibInput}
                    allowNegative
                    className="text-right tabular-nums"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={applyCalibration}
                  disabled={calibPending || !calibPreview}
                >
                  {calibPending ? "Calculando..." : "Aplicar"}
                </Button>
              </div>
              {calibPreview ? (
                <p className="text-xs">
                  Novo saldo inicial:{" "}
                  <span className="font-semibold tabular-nums">
                    {formatBRL(calibPreview)}
                  </span>
                  {calibPreview === movements?.initialBalance ? (
                    <span className="text-muted-foreground ml-1">
                      (igual ao atual — nada a mudar)
                    </span>
                  ) : null}
                </p>
              ) : null}
              {calibError ? (
                <p className="text-xs text-destructive">{calibError}</p>
              ) : null}
              <p className="text-[11px] text-muted-foreground">
                Aplicar preenche o campo "Saldo inicial" — clica em "Salvar"
                pra persistir.
              </p>
            </div>
          ) : null}

          {isCard ? (
            <div className="grid grid-cols-3 gap-4 rounded-md border bg-muted/40 p-3">
              <div className="space-y-2">
                <Label htmlFor="closingDay">Fechamento</Label>
                <Input
                  id="closingDay"
                  name="closingDay"
                  type="number"
                  min={1}
                  max={31}
                  defaultValue={account?.closingDay ?? ""}
                  required
                />
                {errors.closingDay ? (
                  <p className="text-xs text-destructive">{errors.closingDay}</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="dueDay">Vencimento</Label>
                <Input
                  id="dueDay"
                  name="dueDay"
                  type="number"
                  min={1}
                  max={31}
                  defaultValue={account?.dueDay ?? ""}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="creditLimit">Limite</Label>
                <MoneyInput
                  id="creditLimit"
                  name="creditLimit"
                  defaultValue={account?.creditLimit ?? "0"}
                  className="text-right tabular-nums"
                />
              </div>
            </div>
          ) : null}

          {type !== "cash" ? (
            <details className="rounded-md border bg-muted/30 px-3 py-2">
              <summary className="text-sm cursor-pointer text-muted-foreground hover:text-foreground">
                Dados bancários (opcional)
              </summary>
              <div className="grid grid-cols-2 gap-3 pt-3">
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="bankName">Banco</Label>
                  <Input
                    id="bankName"
                    name="bankName"
                    type="text"
                    placeholder="Ex: Nubank, Itaú..."
                    defaultValue={account?.bankName ?? ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bankId">Código (FID)</Label>
                  <Input
                    id="bankId"
                    name="bankId"
                    type="text"
                    placeholder="260"
                    defaultValue={account?.bankId ?? ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="accountBranch">Agência</Label>
                  <Input
                    id="accountBranch"
                    name="accountBranch"
                    type="text"
                    defaultValue={account?.accountBranch ?? ""}
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="accountNumber">Número da conta</Label>
                  <Input
                    id="accountNumber"
                    name="accountNumber"
                    type="text"
                    placeholder="1234567-8"
                    defaultValue={account?.accountNumber ?? ""}
                  />
                </div>
              </div>
            </details>
          ) : null}

          {state?.error && !state.fieldErrors ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ArchiveButton({
  action,
  id,
  label = "Arquivar",
  confirmText = "Arquivar esta conta?",
}: {
  action: (formData: FormData) => void;
  id: string;
  label?: string;
  confirmText?: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!confirm(confirmText)) return;
        const fd = new FormData();
        fd.set("id", id);
        startTransition(() => action(fd));
      }}
    >
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending}
      >
        {label}
      </Button>
    </form>
  );
}

export function DeleteAccountDialog({
  id,
  name,
  transactionCount,
  isCreditCard,
  deleteAction,
}: {
  id: string;
  name: string;
  transactionCount: number;
  isCreditCard: boolean;
  deleteAction: (
    id: string,
    mode: "delete_transactions" | "orphan_transactions",
  ) => Promise<{ ok: true } | { error: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<
    "delete_transactions" | "orphan_transactions"
  >("orphan_transactions");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await deleteAction(id, mode);
      if ("error" in result) setError(result.error);
      else setOpen(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" className="text-destructive">
            Excluir
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Excluir “{name}”</DialogTitle>
          <DialogDescription>
            {transactionCount === 0
              ? "Esta conta não tem lançamentos."
              : `Esta conta tem ${transactionCount} lançamento${transactionCount === 1 ? "" : "s"}. Escolha o que fazer com ${transactionCount === 1 ? "ele" : "eles"}.`}
            {isCreditCard
              ? " As faturas vinculadas também serão removidas."
              : ""}
          </DialogDescription>
        </DialogHeader>

        {transactionCount > 0 ? (
          <div className="space-y-2">
            <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer hover:bg-muted/40">
              <input
                type="radio"
                name="deleteMode"
                checked={mode === "orphan_transactions"}
                onChange={() => setMode("orphan_transactions")}
                className="mt-0.5"
              />
              <div className="text-sm">
                <div className="font-medium">
                  Manter os lançamentos sem conta
                </div>
                <div className="text-xs text-muted-foreground">
                  Lançamentos ficam no histórico marcados como “Sem conta”.
                </div>
              </div>
            </label>
            <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer hover:bg-muted/40">
              <input
                type="radio"
                name="deleteMode"
                checked={mode === "delete_transactions"}
                onChange={() => setMode("delete_transactions")}
                className="mt-0.5"
              />
              <div className="text-sm">
                <div className="font-medium text-destructive">
                  Excluir todos os lançamentos desta conta
                </div>
                <div className="text-xs text-muted-foreground">
                  Apaga {transactionCount} lançamento
                  {transactionCount === 1 ? "" : "s"} permanentemente.
                </div>
              </div>
            </label>
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={submit}
            disabled={pending}
          >
            {pending ? "Excluindo..." : "Excluir conta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
