"use client";

import { useActionState, useEffect, useState } from "react";
import { Plus } from "lucide-react";
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
import { todayISO } from "@/lib/format";
import { addContributionAction } from "./actions";

type Props = {
  planId: string;
  trigger?: React.ReactNode;
};

export function ContributionDialog({ planId, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<
    { error?: string; success?: boolean } | null,
    FormData
  >(addContributionAction, null);

  useEffect(() => {
    if (state?.success) setOpen(false);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          (trigger as React.ReactElement) ?? (
            <Button size="sm">
              <Plus className="size-3.5" /> Aporte
            </Button>
          )
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar aporte</DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="planId" value={planId} />

          <div className="space-y-2">
            <Label htmlFor="amount">Valor</Label>
            <MoneyInput
              id="amount"
              name="amount"
              defaultValue=""
              required
              allowNegative
            />
            <p className="text-xs text-muted-foreground">
              Negativo = saque do plano.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="occurredOn">Data</Label>
            <Input
              id="occurredOn"
              name="occurredOn"
              type="date"
              defaultValue={todayISO()}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Observação (opcional)</Label>
            <Input id="notes" name="notes" maxLength={200} />
          </div>

          {state?.error ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Lançar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
