"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { setReimbursableStatusAction } from "./actions";
import type { IncomeCandidate } from "./reimbursable-row";

type Props = {
  txId: string;
  candidates: IncomeCandidate[];
};

export function CandidateChip({ txId, candidates }: Props) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const markReceived = () => {
    startTransition(async () => {
      await setReimbursableStatusAction(txId, "received");
      setOpen(false);
    });
  };

  if (candidates.length === 1) {
    const c = candidates[0];
    return (
      <button
        type="button"
        onClick={markReceived}
        disabled={pending}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-emerald-300 px-2 py-0.5 text-[10px]",
          "text-emerald-700 dark:text-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/20",
          "hover:bg-emerald-100 dark:hover:bg-emerald-950/40 transition-colors",
        )}
        title={`Receita ${c.description.slice(0, 80)} — clique pra marcar como recebido`}
      >
        <Check className="size-3" />
        Recebido em {formatDate(`${c.occurredOn}T00:00:00`)}
        {c.accountName ? ` · ${c.accountName}` : ""}
      </button>
    );
  }

  // 2+ candidatos: dropdown pra escolher qual receita corresponde
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 rounded-full border border-amber-300 px-2 py-0.5 text-[10px]",
              "text-amber-700 dark:text-amber-400 bg-amber-50/40 dark:bg-amber-950/20",
              "hover:bg-amber-100 dark:hover:bg-amber-950/40 transition-colors",
            )}
            title="Mais de uma receita bate com este valor — clique pra escolher"
          >
            {candidates.length} candidatos
            <ChevronDown className="size-3" />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-72">
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          {candidates.length} receitas com mesmo valor:
        </div>
        <DropdownMenuSeparator />
        {candidates.map((c) => (
          <DropdownMenuItem
            key={c.id}
            onClick={markReceived}
            disabled={pending}
            className="flex-col items-start gap-0.5"
          >
            <span className="text-xs font-medium">
              {formatDate(`${c.occurredOn}T00:00:00`)}
              {c.accountName ? ` · ${c.accountName}` : ""}
            </span>
            <span className="text-[10px] text-muted-foreground truncate w-full">
              {c.cleanDescription || c.description}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
