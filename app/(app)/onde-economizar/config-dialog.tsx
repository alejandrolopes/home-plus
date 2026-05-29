"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Settings2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { bulkSetCategoryRolesAction } from "./actions";

type Category = {
  id: string;
  name: string;
  color: string | null;
  role: "luxury" | "essential" | null;
};

type Props = {
  categories: Category[];
};

export function ConfigDialog({ categories }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  // mapa local com os roles em edição (só commita ao clicar Salvar)
  const [draft, setDraft] = useState<Map<string, "luxury" | "essential" | null>>(
    new Map(),
  );

  useEffect(() => {
    if (open) {
      const m = new Map<string, "luxury" | "essential" | null>();
      for (const c of categories) m.set(c.id, c.role);
      setDraft(m);
      setQuery("");
    }
  }, [open, categories]);

  const filtered = useMemo(() => {
    const q = query
      .toLowerCase()
      .normalize("NFD")
      // eslint-disable-next-line no-misleading-character-class
      .replace(/[̀-ͯ]/g, "")
      .trim();
    return categories
      .filter((c) => {
        if (!q) return true;
        const n = c.name
          .toLowerCase()
          .normalize("NFD")
          // eslint-disable-next-line no-misleading-character-class
          .replace(/[̀-ͯ]/g, "");
        return n.includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [categories, query]);

  const set = (id: string, role: "luxury" | "essential" | null) => {
    setDraft((prev) => {
      const next = new Map(prev);
      next.set(id, role);
      return next;
    });
  };

  const save = () => {
    const updates: Array<{
      categoryId: string;
      role: "luxury" | "essential" | null;
    }> = [];
    for (const c of categories) {
      const newRole = draft.get(c.id) ?? null;
      if (newRole !== c.role) {
        updates.push({ categoryId: c.id, role: newRole });
      }
    }
    if (updates.length === 0) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      await bulkSetCategoryRolesAction(updates);
      setOpen(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Settings2 className="size-3.5" /> Configurar categorias
          </Button>
        }
      />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Classificar categorias</DialogTitle>
          <DialogDescription>
            Marque cada categoria como <strong>Opcional</strong> (potencial de
            corte), <strong>Essencial</strong> (potencial de otimização), ou
            deixe em branco.
          </DialogDescription>
        </DialogHeader>

        <Input
          placeholder="Buscar categoria…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="max-h-96 overflow-auto rounded-md border">
          <ul className="divide-y">
            {filtered.map((c) => {
              const current = draft.get(c.id) ?? null;
              return (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <span className="inline-flex items-center gap-2 min-w-0">
                    {c.color ? (
                      <span
                        aria-hidden
                        className="inline-block size-2.5 rounded-full shrink-0"
                        style={{ background: c.color }}
                      />
                    ) : null}
                    <span className="truncate text-sm">{c.name}</span>
                  </span>
                  <div className="flex gap-1 shrink-0">
                    <RoleButton
                      active={current === "luxury"}
                      onClick={() => set(c.id, "luxury")}
                      activeClass="bg-amber-500 border-amber-500 text-white"
                      idleClass="border-amber-300 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                    >
                      Opcional
                    </RoleButton>
                    <RoleButton
                      active={current === "essential"}
                      onClick={() => set(c.id, "essential")}
                      activeClass="bg-sky-500 border-sky-500 text-white"
                      idleClass="border-sky-300 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/40"
                    >
                      Essencial
                    </RoleButton>
                    <RoleButton
                      active={current === null}
                      onClick={() => set(c.id, null)}
                      activeClass="bg-foreground text-background border-foreground"
                      idleClass="border-border text-muted-foreground hover:bg-muted"
                    >
                      Nenhuma
                    </RoleButton>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoleButton({
  active,
  onClick,
  activeClass,
  idleClass,
  children,
}: {
  active: boolean;
  onClick: () => void;
  activeClass: string;
  idleClass: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "border rounded px-2 py-1 text-[11px] font-medium transition-colors",
        active ? activeClass : idleClass,
      )}
    >
      {children}
    </button>
  );
}
