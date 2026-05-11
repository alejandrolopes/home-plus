"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  updateFamilyNameAction,
  type FamilyNameState,
} from "./actions";

export function FamilyNameForm({ initial }: { initial: string }) {
  const [state, action, pending] = useActionState<FamilyNameState, FormData>(
    updateFamilyNameAction,
    null,
  );
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    setName(initial);
  }, [initial]);

  useEffect(() => {
    if (state?.success) {
      setEditing(false);
      setShowSaved(true);
      const t = setTimeout(() => setShowSaved(false), 2500);
      return () => clearTimeout(t);
    }
  }, [state]);

  const dirty = name !== initial;

  const cancel = () => {
    setName(initial);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">Nome da família</div>
          <div className="font-medium truncate">{initial}</div>
        </div>
        <div className="flex items-center gap-2">
          {showSaved ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
              <Check className="size-3.5" />
              Atualizado
            </span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-3.5" />
            Editar nome
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="family-name">Nome da família</Label>
        <Input
          id="family-name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          required
          autoFocus
        />
        {state?.error ? (
          <p className="text-xs text-destructive">{state.error}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={cancel}
          disabled={pending}
        >
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={pending || !dirty}>
          {pending ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
