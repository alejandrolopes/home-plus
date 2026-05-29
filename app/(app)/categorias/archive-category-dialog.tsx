"use client";

import { useEffect, useState, useTransition } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  archiveCategoryAction,
  countTransactionsInCategoryAction,
} from "./actions";

type CategoryOption = {
  id: string;
  name: string;
  kind: "income" | "expense";
};

type Props = {
  categoryId: string;
  categoryName: string;
  categoryKind: "income" | "expense";
  /** Outras categorias do mesmo kind, não-arquivadas, pra escolher como destino. */
  reassignOptions: CategoryOption[];
};

const NONE = "none";

export function ArchiveCategoryDialog({
  categoryId,
  categoryName,
  categoryKind,
  reassignOptions,
}: Props) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [reassignTo, setReassignTo] = useState<string>(NONE);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCount(null);
    setReassignTo(NONE);
    setError(null);
    countTransactionsInCategoryAction(categoryId).then((r) =>
      setCount(r.count),
    );
  }, [open, categoryId]);

  const handleArchive = () => {
    setError(null);
    const fd = new FormData();
    fd.set("id", categoryId);
    fd.set("reassignToCategoryId", reassignTo);
    startTransition(async () => {
      const r = await archiveCategoryAction(fd);
      if (r?.error) {
        setError(r.error);
        return;
      }
      setOpen(false);
    });
  };

  const filteredOptions = reassignOptions
    .filter((c) => c.id !== categoryId && c.kind === categoryKind)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            Arquivar
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Arquivar &ldquo;{categoryName}&rdquo;</DialogTitle>
          <DialogDescription>
            {count === null
              ? "Verificando lançamentos…"
              : count === 0
                ? "Essa categoria não tem lançamentos. Pode arquivar com segurança."
                : `Essa categoria tem ${count} lançamento${count === 1 ? "" : "s"}. Escolha o que fazer com eles antes de arquivar.`}
          </DialogDescription>
        </DialogHeader>

        {count !== null && count > 0 ? (
          <div className="space-y-2">
            <label className="text-sm">Destino dos lançamentos:</label>
            <Select value={reassignTo} onValueChange={(v) => setReassignTo(v ?? NONE)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v) => {
                    if (!v || v === NONE) return "Sem categoria";
                    return (
                      filteredOptions.find((c) => c.id === v)?.name ??
                      "Sem categoria"
                    );
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sem categoria</SelectItem>
                {filteredOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Os {count} lançamento{count === 1 ? "" : "s"}{" "}
              {reassignTo === NONE
                ? "ficarão sem categoria."
                : `serão movidos pra "${filteredOptions.find((c) => c.id === reassignTo)?.name}".`}
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleArchive}
            disabled={pending || count === null}
          >
            {pending ? "Arquivando…" : "Arquivar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
