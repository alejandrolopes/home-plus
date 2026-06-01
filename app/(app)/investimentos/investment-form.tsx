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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveInvestmentAction, type SaveInvestmentState } from "./actions";

type InvestmentDefaults = {
  id: string;
  institution: string;
  issuer: string | null;
  productName: string;
  class: "fixed_income" | "variable_income";
  maturityDate: string | null;
  color: string | null;
  notes: string | null;
  ownerId: string | null;
};

type Props = {
  trigger: React.ReactNode;
  investment?: InvestmentDefaults;
};

export function InvestmentFormDialog({ trigger, investment }: Props) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<
    SaveInvestmentState,
    FormData
  >(saveInvestmentAction, null);
  const [klass, setKlass] = useState<"fixed_income" | "variable_income">(
    investment?.class ?? "fixed_income",
  );
  const [scope, setScope] = useState<"personal" | "family">(
    investment?.ownerId === null ? "family" : "personal",
  );

  useEffect(() => {
    if (state?.success) setOpen(false);
  }, [state]);

  const errors = state?.fieldErrors ?? {};

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {investment ? "Editar investimento" : "Novo investimento"}
          </DialogTitle>
        </DialogHeader>

        <form action={action} className="space-y-4">
          {investment ? (
            <input type="hidden" name="id" value={investment.id} />
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="institution">Instituição</Label>
              <Input
                id="institution"
                name="institution"
                defaultValue={investment?.institution ?? ""}
                placeholder="Ex.: Nubank, XP, BTG"
                required
                maxLength={80}
              />
              {errors.institution ? (
                <p className="text-xs text-destructive">{errors.institution}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="issuer">Emissor (opcional)</Label>
              <Input
                id="issuer"
                name="issuer"
                defaultValue={investment?.issuer ?? ""}
                placeholder="Ex.: Banco BMG, Tesouro"
                maxLength={80}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="productName">Produto</Label>
            <Input
              id="productName"
              name="productName"
              defaultValue={investment?.productName ?? ""}
              placeholder="Ex.: CDB 115% CDI, BOVA11, Tesouro IPCA+ 2035"
              required
              maxLength={120}
            />
            {errors.productName ? (
              <p className="text-xs text-destructive">{errors.productName}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="class">Classe</Label>
              <Select
                value={klass}
                onValueChange={(v) =>
                  setKlass((v ?? "fixed_income") as typeof klass)
                }
              >
                <SelectTrigger id="class">
                  <SelectValue>
                    {(v) =>
                      v === "variable_income" ? "Renda variável" : "Renda fixa"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed_income">Renda fixa</SelectItem>
                  <SelectItem value="variable_income">Renda variável</SelectItem>
                </SelectContent>
              </Select>
              <input type="hidden" name="class" value={klass} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maturityDate">Vencimento (opcional)</Label>
              <Input
                id="maturityDate"
                name="maturityDate"
                type="date"
                defaultValue={investment?.maturityDate ?? ""}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="color">Cor</Label>
              <Input
                id="color"
                name="color"
                type="color"
                defaultValue={investment?.color ?? "#0ea5e9"}
              />
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
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Observações (opcional)</Label>
            <Input
              id="notes"
              name="notes"
              defaultValue={investment?.notes ?? ""}
              maxLength={500}
            />
          </div>

          {state?.error && !state.fieldErrors ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : investment ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
