"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cancelInvitationAction } from "./actions";

export function CancelInvitationButton({
  invitationId,
}: {
  invitationId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const cancel = () => {
    if (!confirm("Cancelar este convite?")) return;
    setError(null);
    const fd = new FormData();
    fd.append("invitationId", invitationId);
    startTransition(async () => {
      const r = await cancelInvitationAction(fd);
      if ("error" in r) setError(r.error);
    });
  };

  return (
    <div className="flex items-center gap-2">
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button
        variant="ghost"
        size="sm"
        onClick={cancel}
        disabled={pending}
        className="text-destructive hover:text-destructive"
      >
        Cancelar
      </Button>
    </div>
  );
}
