"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  updateFidelidadeAction,
  type FidelidadeState,
} from "./actions";

type Props = {
  initial: {
    tithingEnabled: boolean;
    tithingPct: string;
    pactOfferingPct: string;
  };
  canToggleEnabled?: boolean;
};

export function FidelidadeForm({ initial, canToggleEnabled = false }: Props) {
  const [state, action, pending] = useActionState<FidelidadeState, FormData>(
    updateFidelidadeAction,
    null,
  );
  const [enabled, setEnabled] = useState(initial.tithingEnabled);
  const [pactPct, setPactPct] = useState(
    initial.pactOfferingPct.replace(".", ","),
  );
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (state?.success) {
      setShowSaved(true);
      const t = setTimeout(() => setShowSaved(false), 2000);
      return () => clearTimeout(t);
    }
  }, [state]);

  const dirty =
    (canToggleEnabled && enabled !== initial.tithingEnabled) ||
    pactPct !== initial.pactOfferingPct.replace(".", ",");

  return (
    <form action={action} className="space-y-4">
      {canToggleEnabled ? (
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="fidelidade-enabled" className="text-sm">
              Ativar Fidelidade (família)
            </Label>
            <p className="text-xs text-muted-foreground">
              Liga a feature pra todos os membros. Cada um define seus % abaixo.
            </p>
          </div>
          <Switch
            id="fidelidade-enabled"
            name="enabled"
            checked={enabled}
            onCheckedChange={(v) => setEnabled(Boolean(v))}
          />
        </div>
      ) : !enabled ? (
        <p className="text-xs text-muted-foreground">
          A Fidelidade está desativada para a família. Peça a um admin para
          ativá-la.
        </p>
      ) : null}

      {enabled ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>% Dízimo</Label>
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm tabular-nums text-muted-foreground">
              10% (fixo)
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pactOfferingPct">% Oferta pacto</Label>
            <Input
              id="pactOfferingPct"
              name="pactOfferingPct"
              inputMode="decimal"
              value={pactPct}
              onChange={(e) => setPactPct(e.target.value)}
              className="text-right tabular-nums"
              required
            />
          </div>
        </div>
      ) : null}

      {state?.error ? (
        <p className="text-xs text-destructive">{state.error}</p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || !dirty}>
          {pending ? "Salvando..." : "Salvar Fidelidade"}
        </Button>
        {showSaved ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
            <Check className="size-3.5" />
            Atualizado
          </span>
        ) : null}
      </div>
    </form>
  );
}
