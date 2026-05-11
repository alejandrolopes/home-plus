"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { acceptInvitationAction, rejectInvitationAction } from "./actions";

export function AcceptForm({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const accept = () => {
    setError(null);
    startTransition(async () => {
      const r = await acceptInvitationAction(invitationId);
      if ("error" in r) setError(r.error);
      else router.push("/familia");
    });
  };

  const reject = () => {
    if (!confirm("Recusar este convite?")) return;
    setError(null);
    startTransition(async () => {
      const r = await rejectInvitationAction(invitationId);
      if ("error" in r) setError(r.error);
      else router.push("/dashboard");
    });
  };

  return (
    <div className="space-y-3">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button onClick={accept} disabled={pending}>
          {pending ? "Aceitando..." : "Aceitar convite"}
        </Button>
        <Button variant="outline" onClick={reject} disabled={pending}>
          Recusar
        </Button>
      </div>
    </div>
  );
}
