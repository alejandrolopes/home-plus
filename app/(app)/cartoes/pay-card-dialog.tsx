"use client";

import { useActionState, useEffect, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { todayISO } from "@/lib/format";
import { payCardAction, type PayCardState } from "./pay-card-action";

type Props = {
  cardId: string;
  cardName: string;
  owed: string;
  sourceAccounts: { id: string; name: string }[];
  trigger: React.ReactNode;
};

export function PayCardDialog({
  cardId,
  cardName,
  owed,
  sourceAccounts,
  trigger,
}: Props) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<PayCardState, FormData>(
    payCardAction,
    null,
  );
  const [amount, setAmount] = useState(owed);
  const [sourceId, setSourceId] = useState(sourceAccounts[0]?.id ?? "");

  useEffect(() => {
    if (state?.success) setOpen(false);
  }, [state]);

  useEffect(() => {
    if (open) {
      setAmount(owed);
      setSourceId(sourceAccounts[0]?.id ?? "");
    }
  }, [open, owed, sourceAccounts]);

  const sourceName =
    sourceAccounts.find((a) => a.id === sourceId)?.name ?? "Selecione";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pagar {cardName}</DialogTitle>
          <DialogDescription>
            Registra uma transferência da sua conta para o cartão. Não conta
            como gasto novo (o gasto já foi a compra) e abate o que você deve.
            Para pagamento parcial, informe um valor menor.
          </DialogDescription>
        </DialogHeader>

        {sourceAccounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Cadastre uma conta (corrente, poupança…) para poder pagar o cartão.
          </p>
        ) : (
          <form action={action} className="space-y-4">
            <input type="hidden" name="cardId" value={cardId} />
            <input type="hidden" name="sourceAccountId" value={sourceId} />

            <div className="space-y-2">
              <Label htmlFor="pc-amount">Valor</Label>
              <MoneyInput
                id="pc-amount"
                name="amount"
                value={amount}
                onValueChange={setAmount}
                className="text-right tabular-nums"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Pagar a partir de</Label>
              <Select value={sourceId} onValueChange={(v) => setSourceId(v ?? "")}>
                <SelectTrigger>
                  <SelectValue>{() => sourceName}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {sourceAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pc-date">Data</Label>
              <Input
                id="pc-date"
                name="paidOn"
                type="date"
                defaultValue={todayISO()}
                required
              />
            </div>

            {state?.error ? (
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
                {pending ? "Registrando..." : "Pagar"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
