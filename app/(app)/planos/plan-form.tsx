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
  linkedAccountId: string | null;
  linkedInvestmentId: string | null;
};

type LinkOption = { id: string; label: string };

type Props = {
  trigger: React.ReactNode;
  plan?: PlanDefaults;
  accounts: LinkOption[];
  investments: LinkOption[];
};

export function PlanFormDialog({
  trigger,
  plan,
  accounts,
  investments,
}: Props) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<SavePlanState, FormData>(
    savePlanAction,
    null,
  );
  const [scope, setScope] = useState<"personal" | "family">(
    plan?.ownerId === null ? "family" : "personal",
  );
  const [linkType, setLinkType] = useState<"account" | "investment">(
    plan?.linkedInvestmentId ? "investment" : "account",
  );
  const [linkMode, setLinkMode] = useState<"existing" | "new">("existing");
  const [linkedAccountId, setLinkedAccountId] = useState<string>(
    plan?.linkedAccountId ?? "",
  );
  const [linkedInvestmentId, setLinkedInvestmentId] = useState<string>(
    plan?.linkedInvestmentId ?? "",
  );
  const [newAccountName, setNewAccountName] = useState("");
  const [newInvInstitution, setNewInvInstitution] = useState("");
  const [newInvProduct, setNewInvProduct] = useState("");
  const [newInvClass, setNewInvClass] = useState<
    "fixed_income" | "variable_income"
  >("fixed_income");

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

          <div className="space-y-2 rounded-md border p-3">
            <Label className="text-sm font-medium">
              Onde guardar o dinheiro?
            </Label>
            <p className="text-xs text-muted-foreground">
              O progresso vai vir do saldo da conta ou do investimento que
              você vincular. Não precisa lançar aportes separados.
            </p>
            <div className="flex gap-2">
              {(
                [
                  { v: "account" as const, label: "Conta sem rendimento" },
                  { v: "investment" as const, label: "Investimento" },
                ]
              ).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setLinkType(opt.v)}
                  className={`flex-1 rounded-md border px-3 py-2 text-xs transition-colors ${
                    linkType === opt.v
                      ? "border-primary bg-secondary text-secondary-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <input type="hidden" name="linkType" value={linkType} />
            <input type="hidden" name="linkMode" value={linkMode} />

            {/* Sub-toggle: existente vs novo */}
            <div className="flex gap-2">
              {(
                [
                  { v: "existing" as const, label: "Vincular existente" },
                  { v: "new" as const, label: "Criar nova" },
                ]
              ).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setLinkMode(opt.v)}
                  className={`flex-1 rounded-md border px-3 py-1.5 text-xs transition-colors ${
                    linkMode === opt.v
                      ? "border-primary bg-secondary text-secondary-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {linkType === "account" ? (
              linkMode === "existing" ? (
                <div className="space-y-2">
                  {accounts.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Nenhuma conta existente. Use "Criar nova".
                    </p>
                  ) : (
                    <Select
                      value={linkedAccountId}
                      onValueChange={(v) => setLinkedAccountId(v ?? "")}
                    >
                      <SelectTrigger>
                        <SelectValue>
                          {(v) =>
                            accounts.find((a) => a.id === v)?.label ??
                            "Selecione uma conta"
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <input
                    type="hidden"
                    name="linkedAccountId"
                    value={linkedAccountId}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    name="newAccountName"
                    placeholder="Nome da conta (ex.: Caixinha Reserva)"
                    value={newAccountName}
                    onChange={(e) => setNewAccountName(e.target.value)}
                    maxLength={80}
                  />
                  <p className="text-xs text-muted-foreground">
                    Cria conta tipo "Corrente" com saldo inicial R$ 0,00.
                    Você pode ajustar depois em /contas.
                  </p>
                </div>
              )
            ) : linkMode === "existing" ? (
              <div className="space-y-2">
                {investments.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhum investimento existente. Use "Criar novo".
                  </p>
                ) : (
                  <Select
                    value={linkedInvestmentId}
                    onValueChange={(v) => setLinkedInvestmentId(v ?? "")}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {(v) =>
                          investments.find((i) => i.id === v)?.label ??
                          "Selecione um investimento"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {investments.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <input
                  type="hidden"
                  name="linkedInvestmentId"
                  value={linkedInvestmentId}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Input
                  name="newInvestmentInstitution"
                  placeholder="Instituição (ex.: Nubank, XP)"
                  value={newInvInstitution}
                  onChange={(e) => setNewInvInstitution(e.target.value)}
                  maxLength={80}
                />
                <Input
                  name="newInvestmentProductName"
                  placeholder="Produto (ex.: CDB 115% CDI, BOVA11)"
                  value={newInvProduct}
                  onChange={(e) => setNewInvProduct(e.target.value)}
                  maxLength={120}
                />
                <Select
                  value={newInvClass}
                  onValueChange={(v) =>
                    setNewInvClass(
                      (v ?? "fixed_income") as
                        | "fixed_income"
                        | "variable_income",
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue>
                      {(v) =>
                        v === "variable_income"
                          ? "Renda variável"
                          : "Renda fixa"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed_income">Renda fixa</SelectItem>
                    <SelectItem value="variable_income">
                      Renda variável
                    </SelectItem>
                  </SelectContent>
                </Select>
                <input
                  type="hidden"
                  name="newInvestmentClass"
                  value={newInvClass}
                />
                <p className="text-xs text-muted-foreground">
                  Você pode adicionar emissor, vencimento e snapshots depois
                  em /investimentos.
                </p>
              </div>
            )}
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
