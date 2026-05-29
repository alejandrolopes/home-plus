"use client";

import { useTransition } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setReimbursableStatusAction } from "./actions";

type Props = {
  txId: string;
  status: "pending" | "received";
};

export function ReimbursableActionsCell({ txId, status }: Props) {
  const [pending, startTransition] = useTransition();

  const setStatus = (next: "none" | "pending" | "received") => {
    startTransition(async () => {
      await setReimbursableStatusAction(txId, next);
    });
  };

  if (status === "pending") {
    return (
      <div className="flex items-center justify-end gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => setStatus("received")}
          title="Marcar como recebido (move pro histórico)"
        >
          <Check className="size-3" /> Recebido
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setStatus("none")}
          title="Desmarcar (não é mais reembolsável)"
        >
          <X className="size-3" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => setStatus("pending")}
      title="Voltar pra aguardando"
    >
      <RotateCcw className="size-3" /> Reabrir
    </Button>
  );
}
