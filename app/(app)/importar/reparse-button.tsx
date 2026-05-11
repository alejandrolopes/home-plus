"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { reparseDescriptionsAction } from "./actions";

export function ReparseButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    updated: number;
    skipped: number;
  } | null>(null);

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (!confirm("Re-processar descrições de todos os lançamentos?"))
            return;
          startTransition(async () => {
            const r = await reparseDescriptionsAction();
            setResult(r);
          });
        }}
      >
        {pending ? "Processando..." : "Reprocessar agora"}
      </Button>
      {result ? (
        <span className="text-xs text-muted-foreground">
          {result.updated} atualizado{result.updated === 1 ? "" : "s"}
          {result.skipped > 0 ? ` · ${result.skipped} ignorado${result.skipped === 1 ? "" : "s"}` : ""}
        </span>
      ) : null}
    </div>
  );
}
