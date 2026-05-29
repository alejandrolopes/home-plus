"use client";

import { useTransition } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toggleManuallyPaidAction } from "./actions";

type Props = {
  invoiceId: string;
  manuallyPaid: boolean;
};

export function ManuallyPaidToggle({ invoiceId, manuallyPaid }: Props) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await toggleManuallyPaidAction(invoiceId, !manuallyPaid);
        });
      }}
      title={
        manuallyPaid
          ? "Desfazer marca manual (recomputa status do saldo)"
          : "Marcar fatura como paga manualmente (ignora saldo restante)"
      }
    >
      {manuallyPaid ? (
        <>
          <X className="size-3" /> Reabrir
        </>
      ) : (
        <>
          <Check className="size-3" /> Marcar paga
        </>
      )}
    </Button>
  );
}
