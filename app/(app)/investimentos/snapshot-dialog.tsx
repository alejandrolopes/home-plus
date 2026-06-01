"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { currentMonthISO } from "@/lib/format";
import { saveSnapshotAction } from "./actions";

type Props = {
  investmentId: string;
  /** Pré-popular com snapshot existente do mês (edição) ou criar novo. */
  defaultMonth?: string;
  defaultApplied?: string;
  defaultBalance?: string;
  defaultNotes?: string | null;
  trigger: React.ReactNode;
};

export function SnapshotDialog({
  investmentId,
  defaultMonth,
  defaultApplied,
  defaultBalance,
  defaultNotes,
  trigger,
}: Props) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<
    { error?: string; success?: boolean } | null,
    FormData
  >(saveSnapshotAction, null);

  useEffect(() => {
    if (state?.success) setOpen(false);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {defaultMonth ? "Editar snapshot" : "Novo snapshot"}
          </DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="investmentId" value={investmentId} />

          <div className="space-y-2">
            <Label htmlFor="month">Mês</Label>
            <Input
              id="month"
              name="month"
              type="month"
              defaultValue={defaultMonth ?? currentMonthISO()}
              required
              readOnly={!!defaultMonth}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="applied">Aporte no mês</Label>
              <MoneyInput
                id="applied"
                name="applied"
                defaultValue={defaultApplied ?? "0.00"}
                allowNegative
              />
              <p className="text-xs text-muted-foreground">
                Negativo = resgate.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="balance">Saldo no fim do mês</Label>
              <MoneyInput
                id="balance"
                name="balance"
                defaultValue={defaultBalance ?? "0.00"}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Observação (opcional)</Label>
            <Input
              id="notes"
              name="notes"
              defaultValue={defaultNotes ?? ""}
              maxLength={200}
            />
          </div>

          {state?.error ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
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
