"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Check } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBRL, todayISO } from "@/lib/format";
import type {
  IncomeCandidate,
  ReimbursementRow,
} from "@/lib/repos/reimbursements";
import { cn } from "@/lib/utils";
import {
  createIncomeForReimbursementAction,
  settleReimbursementAction,
} from "./actions";

const dayMonthFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
});

function fmt(iso: string): string {
  return dayMonthFormatter.format(new Date(`${iso}T00:00:00`));
}

type AccountOption = {
  id: string;
  name: string;
  type: "checking" | "savings" | "cash" | "credit_card" | "investment";
  color: string | null;
};

export function SettleDialog({
  target,
  onClose,
  candidates,
  accounts,
}: {
  target: ReimbursementRow | null;
  onClose: () => void;
  candidates: IncomeCandidate[];
  accounts: AccountOption[];
}) {
  const open = !!target;
  const [mode, setMode] = useState<"existing" | "create">("existing");
  const [selectedIncomeId, setSelectedIncomeId] = useState<string | null>(null);
  const [matchAmount, setMatchAmount] = useState(true);
  const [newAccountId, setNewAccountId] = useState<string>("");
  const [newOccurredOn, setNewOccurredOn] = useState<string>(todayISO());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setMode("existing");
    setSelectedIncomeId(null);
    setMatchAmount(true);
    setNewAccountId(
      accounts.find((a) => a.type !== "credit_card")?.id ?? "",
    );
    setNewOccurredOn(todayISO());
    setError(null);
  }, [open, accounts]);

  const filteredCandidates = useMemo(() => {
    if (!target) return [];
    if (!matchAmount) return candidates;
    return candidates.filter((c) => c.amount === target.expense.amount);
  }, [target, candidates, matchAmount]);

  const handleOpenChange = (next: boolean) => {
    if (!next && !pending) onClose();
  };

  const submit = () => {
    if (!target) return;
    setError(null);
    if (mode === "existing") {
      if (!selectedIncomeId) {
        setError("Selecione uma receita para vincular.");
        return;
      }
      startTransition(async () => {
        const r = await settleReimbursementAction(target.id, selectedIncomeId);
        if ("error" in r) {
          setError(r.error);
          return;
        }
        onClose();
      });
    } else {
      if (!newAccountId) {
        setError("Selecione uma conta para creditar.");
        return;
      }
      startTransition(async () => {
        const r = await createIncomeForReimbursementAction(
          target.id,
          newAccountId,
          newOccurredOn,
        );
        if ("error" in r) {
          setError(r.error);
          return;
        }
        onClose();
      });
    }
  };

  if (!target) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Marcar como reembolsado</DialogTitle>
          <DialogDescription>
            {target.expense.cleanDescription ?? target.expense.description} ·{" "}
            <span className="text-rose-600 font-medium tabular-nums">
              {formatBRL(target.expense.amount)}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-md bg-muted p-0.5 w-fit">
          <ModeButton
            active={mode === "existing"}
            onClick={() => setMode("existing")}
            label="Vincular receita existente"
          />
          <ModeButton
            active={mode === "create"}
            onClick={() => setMode("create")}
            label="Criar receita"
          />
        </div>

        {mode === "existing" ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Receitas candidatas</Label>
              <label className="text-xs text-muted-foreground inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={matchAmount}
                  onChange={(e) => setMatchAmount(e.target.checked)}
                  className="size-3.5 accent-primary"
                />
                Mesmo valor
              </label>
            </div>
            {filteredCandidates.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
                {matchAmount
                  ? "Nenhuma receita com o mesmo valor nos últimos 90 dias. Desmarque para ver todas ou crie uma receita."
                  : "Nenhuma receita disponível para vincular."}
              </div>
            ) : (
              <ul className="max-h-72 overflow-y-auto rounded-md border divide-y">
                {filteredCandidates.map((c) => {
                  const checked = selectedIncomeId === c.id;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedIncomeId(c.id)}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40 transition-colors",
                          checked && "bg-primary/5",
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "inline-flex items-center justify-center size-4 rounded-full border shrink-0",
                            checked
                              ? "bg-primary border-primary text-primary-foreground"
                              : "border-muted-foreground/40",
                          )}
                        >
                          {checked ? <Check className="size-3" /> : null}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">
                            {c.cleanDescription ?? c.description}
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap mt-0.5">
                            <span>{fmt(c.occurredOn)}</span>
                            {c.accountName ? (
                              <span className="inline-flex items-center gap-1">
                                <span
                                  aria-hidden
                                  className="size-1.5 rounded-full"
                                  style={{
                                    backgroundColor:
                                      c.accountColor ?? "currentColor",
                                  }}
                                />
                                {c.accountName}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <span className="tabular-nums font-medium text-emerald-600 shrink-0">
                          {formatBRL(c.amount)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Cria uma receita com o mesmo valor da compra e vincula
              automaticamente.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="newAccountId">Conta destino</Label>
                <Select
                  value={newAccountId}
                  onValueChange={(v) => setNewAccountId(v ?? "")}
                >
                  <SelectTrigger id="newAccountId">
                    <SelectValue>
                      {(v) =>
                        accounts.find((a) => a.id === v)?.name ?? "Selecione"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {accounts
                      .filter((a) => a.type !== "credit_card")
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="newOccurredOn">Data</Label>
                <Input
                  id="newOccurredOn"
                  type="date"
                  value={newOccurredOn}
                  onChange={(e) => setNewOccurredOn(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter className="pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending
              ? "Salvando…"
              : mode === "existing"
                ? "Vincular"
                : "Criar e vincular"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1 rounded-sm text-xs font-medium transition-colors",
        active
          ? "bg-background shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
