"use client";

import { useEffect } from "react";
import { useActionState } from "react";
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
  createFamilyAction,
  type OnboardingState,
} from "@/app/onboarding/actions";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CreateFamilyDialog({ open, onOpenChange }: Props) {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(
    createFamilyAction,
    null,
  );

  useEffect(() => {
    if (state && !state.error) onOpenChange(false);
  }, [state, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova família</DialogTitle>
          <DialogDescription>
            Crie um novo espaço de gestão financeira. Cada família tem suas
            próprias contas, lançamentos e cartões.
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="family-name">Nome</Label>
            <Input
              id="family-name"
              name="name"
              required
              autoFocus
              placeholder="Ex: Família Lopes"
            />
          </div>

          {state?.error ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Criando..." : "Criar família"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
