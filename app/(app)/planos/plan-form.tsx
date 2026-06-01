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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { savePlanAction, type SavePlanState } from "./actions";

type PlanDefaults = {
  id: string;
  name: string;
  description: string | null;
  targetCents: number;
  startDate: string;
  endDate: string;
  color: string | null;
  ownerId: string | null;
};

type Props = {
  trigger: React.ReactNode;
  plan?: PlanDefaults;
};

export function PlanFormDialog({ trigger, plan }: Props) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<SavePlanState, FormData>(
    savePlanAction,
    null,
  );
  const [scope, setScope] = useState<"personal" | "family">(
    plan?.ownerId === null ? "family" : "personal",
  );

  useEffect(() => {
    if (state?.success) setOpen(false);
  }, [state]);

  const errors = state?.fieldErrors ?? {};
  const initialTarget = plan ? (plan.targetCents / 100).toFixed(2) : "";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{plan ? "Editar plano" : "Novo plano"}</DialogTitle>
        </DialogHeader>

        <form action={action} className="space-y-4">
          {plan ? <input type="hidden" name="id" value={plan.id} /> : null}

          <div className="space-y-2">
            <Label htmlFor="name">Nome</Label>
            <Input
              id="name"
              name="name"
              defaultValue={plan?.name ?? ""}
              placeholder="Ex.: Viagem ao exterior"
              required
              autoFocus
              maxLength={80}
            />
            {errors.name ? (
              <p className="text-xs text-destructive">{errors.name}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descrição (opcional)</Label>
            <Input
              id="description"
              name="description"
              defaultValue={plan?.description ?? ""}
              maxLength={500}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="target">Valor alvo</Label>
              <MoneyInput
                id="target"
                name="target"
                defaultValue={initialTarget}
                required
              />
              {errors.target ? (
                <p className="text-xs text-destructive">{errors.target}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="color">Cor</Label>
              <Input
                id="color"
                name="color"
                type="color"
                defaultValue={plan?.color ?? "#0ea5e9"}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startDate">Início</Label>
              <Input
                id="startDate"
                name="startDate"
                type="date"
                defaultValue={plan?.startDate ?? ""}
                required
              />
              {errors.startDate ? (
                <p className="text-xs text-destructive">{errors.startDate}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">Fim (meta)</Label>
              <Input
                id="endDate"
                name="endDate"
                type="date"
                defaultValue={plan?.endDate ?? ""}
                required
              />
              {errors.endDate ? (
                <p className="text-xs text-destructive">{errors.endDate}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="scope">Visibilidade</Label>
            <Select
              value={scope}
              onValueChange={(v) =>
                setScope((v ?? "personal") as "personal" | "family")
              }
            >
              <SelectTrigger id="scope">
                <SelectValue>
                  {(v) =>
                    v === "family"
                      ? "Família (todos veem)"
                      : "Pessoal (só você)"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="personal">Pessoal (só você)</SelectItem>
                <SelectItem value="family">Família (todos veem)</SelectItem>
              </SelectContent>
            </Select>
            <input type="hidden" name="scope" value={scope} />
          </div>

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
              {pending ? "Salvando..." : plan ? "Salvar" : "Criar plano"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
