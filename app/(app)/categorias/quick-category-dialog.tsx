"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { quickCreateCategoryAction, type QuickCategoryState } from "./actions";

export type QuickCategoryResult = {
  id: string;
  name: string;
  kind: "income" | "expense";
  color: string | null;
  parentId?: string | null;
};

export type QuickCategoryParent = {
  id: string;
  name: string;
  kind: "income" | "expense";
};

const NONE = "__none__";
const NEW_PARENT = "__new_parent__";

export function QuickCategoryDialog({
  open,
  onOpenChange,
  kind,
  onCreated,
  parents = [],
  defaultParentId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "income" | "expense";
  onCreated: (cat: QuickCategoryResult) => void;
  parents?: QuickCategoryParent[];
  defaultParentId?: string;
}) {
  const [state, action, pending] = useActionState<
    QuickCategoryState,
    FormData
  >(quickCreateCategoryAction, null);

  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;
  const firedForRef = useRef<QuickCategoryResult | null>(null);

  useEffect(() => {
    if (state?.success && firedForRef.current !== state.success) {
      firedForRef.current = state.success;
      onCreatedRef.current(state.success);
    }
  }, [state]);

  const [parentMode, setParentMode] = useState<"none" | "existing" | "new">(
    defaultParentId ? "existing" : "none",
  );
  const [parentId, setParentId] = useState<string>(defaultParentId ?? "");

  useEffect(() => {
    if (open) {
      setParentMode(defaultParentId ? "existing" : "none");
      setParentId(defaultParentId ?? "");
    }
  }, [open, defaultParentId]);

  const eligibleParents = parents.filter((p) => p.kind === kind);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Nova categoria</DialogTitle>
          <DialogDescription>
            Categoria de {kind === "income" ? "receita" : "despesa"}.
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="space-y-3">
          <input type="hidden" name="kind" value={kind} />
          <div className="space-y-1.5">
            <Label htmlFor="quick-cat-name">Nome</Label>
            <Input
              id="quick-cat-name"
              name="name"
              placeholder="Ex: Pet"
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quick-cat-color">Cor</Label>
            <Input
              id="quick-cat-color"
              name="color"
              type="color"
              defaultValue="#64748b"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Categoria mãe (opcional)</Label>
            <Select
              value={
                parentMode === "existing" && parentId
                  ? parentId
                  : parentMode === "new"
                    ? NEW_PARENT
                    : NONE
              }
              onValueChange={(v) => {
                if (v === NEW_PARENT) {
                  setParentMode("new");
                  setParentId("");
                } else if (v === NONE || !v) {
                  setParentMode("none");
                  setParentId("");
                } else {
                  setParentMode("existing");
                  setParentId(v);
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v) => {
                    if (!v || v === NONE) return "— Nenhuma (raiz)";
                    if (v === NEW_PARENT) return "✨ Nova mãe (criar abaixo)";
                    return (
                      eligibleParents.find((p) => p.id === v)?.name ?? "—"
                    );
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— Nenhuma (raiz)</SelectItem>
                {eligibleParents.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
                <SelectItem
                  value={NEW_PARENT}
                  className="text-primary border-t mt-1 pt-1.5"
                >
                  ✨ Nova mãe...
                </SelectItem>
              </SelectContent>
            </Select>
            {parentMode === "existing" && parentId ? (
              <input type="hidden" name="parentId" value={parentId} />
            ) : null}
          </div>

          {parentMode === "new" ? (
            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                Cria a categoria-mãe e a subcategoria de uma vez.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="quick-new-parent-name">Nome da mãe</Label>
                <Input
                  id="quick-new-parent-name"
                  name="newParentName"
                  placeholder={
                    kind === "income" ? "Ex: Investimentos" : "Ex: Veículo"
                  }
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quick-new-parent-color">Cor da mãe</Label>
                <Input
                  id="quick-new-parent-color"
                  name="newParentColor"
                  type="color"
                  defaultValue="#475569"
                />
              </div>
            </div>
          ) : null}

          {state?.error ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Criando..." : "Criar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
