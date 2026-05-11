"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { Plus, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  inviteMemberAction,
  type InviteState,
} from "./actions";

export function InviteDialog() {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<"member" | "admin">("member");
  const [copied, setCopied] = useState(false);
  const [state, action, pending] = useActionState<InviteState, FormData>(
    inviteMemberAction,
    null,
  );

  useEffect(() => {
    if (open) {
      setRole("member");
      setCopied(false);
    }
  }, [open]);

  const handleCopy = async () => {
    if (!state?.inviteLink) return;
    try {
      await navigator.clipboard.writeText(state.inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus className="size-4" />
            Convidar membro
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Convidar para a família</DialogTitle>
          <DialogDescription>
            O convidado precisa criar uma conta com este email. Compartilhe o
            link gerado para ele aceitar.
          </DialogDescription>
        </DialogHeader>

        {state?.inviteLink ? (
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
              <p className="text-xs text-muted-foreground">Link de convite:</p>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={state.inviteLink}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  onClick={handleCopy}
                >
                  {copied ? <Check /> : <Copy />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Compartilhe esse link com o convidado. Ele precisa estar logado
                com o email convidado para aceitar.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Fechar</Button>
            </DialogFooter>
          </div>
        ) : (
          <form action={action} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                name="email"
                type="email"
                placeholder="exemplo@dominio.com"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Papel</Label>
              <Select
                name="role"
                value={role}
                onValueChange={(v) => setRole((v as "member" | "admin") ?? "member")}
              >
                <SelectTrigger id="invite-role" className="w-full">
                  <SelectValue>
                    {(v) =>
                      v === "admin" ? "Admin (pode editar tudo)" : "Membro"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Membro</SelectItem>
                  <SelectItem value="admin">Admin (pode editar tudo)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {state?.error ? (
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
                {pending ? "Enviando..." : "Convidar"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
