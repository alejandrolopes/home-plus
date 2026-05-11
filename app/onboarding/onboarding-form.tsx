"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createFamilyAction } from "./actions";

export function OnboardingForm() {
  const [state, action, pending] = useActionState(createFamilyAction, null);

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Nome da família</Label>
        <Input
          id="name"
          name="name"
          type="text"
          placeholder="Ex: Família Lopes"
          required
          autoFocus
        />
      </div>
      {state?.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Criando..." : "Criar família"}
      </Button>
    </form>
  );
}
