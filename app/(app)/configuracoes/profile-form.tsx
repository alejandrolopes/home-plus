"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfileAction, type ProfileState } from "./actions";

export function ProfileForm({
  initialName,
  initialEmail,
}: {
  initialName: string;
  initialEmail: string;
}) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(
    updateProfileAction,
    null,
  );
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [showSaved, setShowSaved] = useState(false);

  // Re-sincroniza ao receber novo valor do servidor (após revalidatePath).
  useEffect(() => {
    setName(initialName);
  }, [initialName]);
  useEffect(() => {
    setEmail(initialEmail);
  }, [initialEmail]);

  // Fecha o form e dá flash de "Atualizado" quando salva com sucesso.
  useEffect(() => {
    if (state?.success) {
      setEditing(false);
      setShowSaved(true);
      const t = setTimeout(() => setShowSaved(false), 2500);
      return () => clearTimeout(t);
    }
  }, [state]);

  const dirty = name !== initialName || email !== initialEmail;

  const cancel = () => {
    setName(initialName);
    setEmail(initialEmail);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setEditing(true)}
        >
          <Pencil className="size-3.5" />
          Editar perfil
        </Button>
        {showSaved ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
            <Check className="size-3.5" />
            Atualizado
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="profile-name">Nome</Label>
          <Input
            id="profile-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-email">Email</Label>
          <Input
            id="profile-email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
      </div>

      {state?.error ? (
        <p className="text-xs text-destructive">{state.error}</p>
      ) : null}

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
