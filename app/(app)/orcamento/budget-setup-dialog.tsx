"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BudgetRow, type BudgetRowData } from "./budget-row";

type Props = {
  rows: BudgetRowData[];
  monthLabel: string;
  scope: "default" | "month";
};

export function BudgetSetupDialog({ rows, monthLabel, scope }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = rows.filter((r) => {
    if (!query.trim()) return true;
    return r.displayName.toLowerCase().includes(query.toLowerCase());
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Settings2 className="size-4" />
            Definir orçamento
          </Button>
        }
      />
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {scope === "month"
              ? `Definir orçamento — ${monthLabel}`
              : "Definir orçamento padrão"}
          </DialogTitle>
          <DialogDescription>
            Clica no valor de qualquer categoria pra editar. Use ✨ pra
            preencher com a média dos últimos 6 meses.
          </DialogDescription>
        </DialogHeader>

        <Input
          placeholder="Filtrar categoria..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="max-h-[60vh] overflow-y-auto divide-y rounded-md border">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4 text-center">
              Nenhuma categoria encontrada.
            </p>
          ) : (
            filtered.map((r) => (
              <BudgetRow key={`${r.scope}-${r.categoryId}`} row={r} />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
