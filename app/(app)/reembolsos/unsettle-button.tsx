"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { unsettleReimbursementAction } from "./actions";

export function UnsettleButton({
  reimbursementId,
}: {
  reimbursementId: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!confirm("Desfazer reembolso? A receita continua existindo.")) {
          return;
        }
        startTransition(async () => {
          await unsettleReimbursementAction(reimbursementId);
        });
      }}
    >
      {pending ? "..." : "Desfazer"}
    </Button>
  );
}
