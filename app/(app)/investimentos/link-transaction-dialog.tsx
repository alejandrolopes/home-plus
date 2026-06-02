"use client";

import { useActionState, useEffect, useState } from "react";
import { Link as LinkIcon } from "lucide-react";
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
import { formatBRL, formatDate } from "@/lib/format";
import { linkTransactionAction } from "./actions";

type Candidate = {
  id: string;
  accountName: string | null;
  amount: string;
  description: string;
  cleanDescription: string | null;
  occurredOn: string;
};

type Props = {
  investmentId: string;
  candidates: Candidate[];
  trigger?: React.ReactNode;
};

export function LinkTransactionDialog({
  investmentId,
  candidates,
  trigger,
}: Props) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [state, action, pending] = useActionState<
    { error?: string; success?: boolean } | null,
    FormData
  >(linkTransactionAction, null);

  useEffect(() => {
    if (state?.success) {
      setOpen(false);
      setSelectedId(null);
      setQuery("");
    }
  }, [state]);

  const filtered = candidates.filter((c) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      (c.cleanDescription ?? c.description).toLowerCase().includes(q) ||
      (c.accountName ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          (trigger as React.ReactElement) ?? (
            <Button size="sm" variant="outline">
              <LinkIcon className="size-3.5" />
              Vincular transação
            </Button>
          )
        }
      />
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Vincular transação como aporte</DialogTitle>
          <DialogDescription>
            Escolha uma despesa da sua conta corrente para registrar como
            aporte. O snapshot do mês é atualizado automaticamente.
          </DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nenhuma despesa elegível nos últimos 90 dias. Lance a despesa do
            aporte primeiro em /lancamentos.
          </p>
        ) : (
          <form action={action} className="space-y-3">
            <input type="hidden" name="investmentId" value={investmentId} />
            <input
              type="hidden"
              name="transactionId"
              value={selectedId ?? ""}
            />

            <Input
              placeholder="Filtrar por descrição ou conta..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            <div className="max-h-[360px] overflow-y-auto rounded-md border divide-y">
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground p-3 text-center">
                  Nada encontrado.
                </p>
              ) : (
                filtered.map((c) => {
                  const isSelected = selectedId === c.id;
                  return (
                    <label
                      key={c.id}
                      className={`flex items-center gap-3 p-3 cursor-pointer text-sm ${
                        isSelected ? "bg-secondary" : "hover:bg-muted/40"
                      }`}
                    >
                      <input
                        type="radio"
                        name="select"
                        checked={isSelected}
                        onChange={() => setSelectedId(c.id)}
                        className="size-4 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">
                          {c.cleanDescription ?? c.description}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(`${c.occurredOn}T00:00:00`)}
                          {c.accountName ? ` · ${c.accountName}` : ""}
                        </div>
                      </div>
                      <div className="tabular-nums shrink-0">
                        {formatBRL(c.amount)}
                      </div>
                    </label>
                  );
                })
              )}
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
              <Button type="submit" disabled={pending || !selectedId}>
                {pending ? "Vinculando..." : "Vincular"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
