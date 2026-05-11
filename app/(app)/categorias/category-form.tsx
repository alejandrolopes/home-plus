"use client";

import { useEffect, useState, useTransition } from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveCategoryAction, type CategoryFormState } from "./actions";
import type { Category } from "@/lib/repos/categories";

type Props = {
  trigger: React.ReactNode;
  category?: Category;
  defaultKind?: Category["kind"];
  defaultParentId?: string;
  parents?: Pick<Category, "id" | "name" | "kind">[];
};

const NO_PARENT = "__none__";

export function CategoryFormDialog({
  trigger,
  category,
  defaultKind,
  defaultParentId,
  parents = [],
}: Props) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<CategoryFormState, FormData>(
    saveCategoryAction,
    null,
  );

  const initialKind: Category["kind"] =
    category?.kind ?? defaultKind ?? "expense";
  const initialParentId = category?.parentId ?? defaultParentId ?? "";

  const [parentId, setParentId] = useState<string>(initialParentId);
  const [kind, setKind] = useState<Category["kind"]>(initialKind);

  useEffect(() => {
    if (state?.success) setOpen(false);
  }, [state]);

  useEffect(() => {
    if (open) {
      setParentId(initialParentId);
      setKind(initialKind);
    }
  }, [open, initialParentId, initialKind]);

  const parentKind = parentId
    ? parents.find((p) => p.id === parentId)?.kind
    : undefined;
  const effectiveKind = parentKind ?? kind;
  const kindLocked = !!parentKind;
  const filteredParents = parents.filter(
    (p) => p.id !== category?.id && (!kindLocked ? p.kind === kind : true),
  );

  const errors = state?.fieldErrors ?? {};

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {category ? "Editar categoria" : "Nova categoria"}
          </DialogTitle>
        </DialogHeader>

        <form action={action} className="space-y-4">
          {category ? (
            <input type="hidden" name="id" value={category.id} />
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="name">Nome</Label>
            <Input
              id="name"
              name="name"
              defaultValue={category?.name ?? ""}
              required
              autoFocus
            />
            {errors.name ? (
              <p className="text-xs text-destructive">{errors.name}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="parentId">Categoria-mãe (opcional)</Label>
            <Select
              value={parentId || NO_PARENT}
              onValueChange={(v) => setParentId(v === NO_PARENT ? "" : (v ?? ""))}
            >
              <SelectTrigger id="parentId">
                <SelectValue>
                  {(v) => {
                    if (!v || v === NO_PARENT) return "— Nenhuma (raiz)";
                    return parents.find((p) => p.id === v)?.name ?? "—";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT}>— Nenhuma (raiz)</SelectItem>
                {filteredParents.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}{" "}
                    <span className="text-muted-foreground">
                      ({p.kind === "income" ? "receita" : "despesa"})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="parentId" value={parentId} />
            {kindLocked ? (
              <p className="text-xs text-muted-foreground">
                Tipo herdado da categoria-mãe.
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="kind">Tipo</Label>
              <Select
                value={effectiveKind}
                onValueChange={(v) => {
                  if (!kindLocked) setKind((v ?? "expense") as Category["kind"]);
                }}
                disabled={kindLocked}
              >
                <SelectTrigger id="kind">
                  <SelectValue>
                    {(v) => (v === "income" ? "Receita" : "Despesa")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">Despesa</SelectItem>
                  <SelectItem value="income">Receita</SelectItem>
                </SelectContent>
              </Select>
              <input type="hidden" name="kind" value={effectiveKind} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="color">Cor</Label>
              <Input
                id="color"
                name="color"
                type="color"
                defaultValue={category?.color ?? "#64748b"}
              />
            </div>
          </div>

          {state?.error && !state.fieldErrors ? (
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
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ArchiveButton({
  action,
  id,
}: {
  action: (formData: FormData) => void;
  id: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!confirm("Arquivar esta categoria?")) return;
        const fd = new FormData();
        fd.set("id", id);
        startTransition(() => action(fd));
      }}
    >
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        Arquivar
      </Button>
    </form>
  );
}

export function SeedDefaultsButton({
  action,
}: {
  action: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      onClick={() => startTransition(() => action())}
      disabled={pending}
    >
      {pending ? "Criando..." : "Criar categorias padrão"}
    </Button>
  );
}
