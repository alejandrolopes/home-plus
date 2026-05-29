"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { bulkUpdateInlineAction } from "@/app/(app)/lancamentos/actions";

export type PickerCategory = {
  id: string;
  name: string;
  kind: "income" | "expense";
  color?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  txId: string;
  currentCategoryId: string | null;
  currentKind: "income" | "expense";
  categories: PickerCategory[];
  onChanged?: () => void;
};

/** Normaliza: lowercase, sem acentos, sem pontuação, tokens só de letras/dígitos. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normalize(s).split(" ").filter(Boolean);
}

export function CategoryPickerDialog({
  open,
  onOpenChange,
  txId,
  currentCategoryId,
  currentKind,
  categories,
  onChanged,
}: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  const listRef = useRef<HTMLUListElement>(null);

  // Sempre que abre ou o filtro muda, volta o foco-do-teclado pra primeira opção.
  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  const ranked = useMemo(() => {
    const queryTokens = tokens(query);
    // Sem query: lista todas, kind atual primeiro, alfabético.
    if (queryTokens.length === 0) {
      return [...categories].sort((a, b) => {
        const ka = a.kind === currentKind ? 0 : 1;
        const kb = b.kind === currentKind ? 0 : 1;
        if (ka !== kb) return ka - kb;
        return a.name.localeCompare(b.name, "pt-BR");
      });
    }
    type Scored = { cat: PickerCategory; score: number };
    const scored: Scored[] = [];
    for (const cat of categories) {
      const catTokens = tokens(cat.name);
      let score = 0;
      for (const q of queryTokens) {
        // Match exato de token: +3; prefix: +2; substring em qualquer token: +1
        let bestForQ = 0;
        for (const t of catTokens) {
          if (t === q) bestForQ = Math.max(bestForQ, 3);
          else if (t.startsWith(q)) bestForQ = Math.max(bestForQ, 2);
          else if (t.includes(q)) bestForQ = Math.max(bestForQ, 1);
        }
        score += bestForQ;
      }
      if (score > 0) scored.push({ cat, score });
    }
    scored.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      // Empate: kind atual primeiro, depois alfabético
      const ka = a.cat.kind === currentKind ? 0 : 1;
      const kb = b.cat.kind === currentKind ? 0 : 1;
      if (ka !== kb) return ka - kb;
      return a.cat.name.localeCompare(b.cat.name, "pt-BR");
    });
    return scored.map((s) => s.cat);
  }, [query, categories, currentKind]);

  const apply = (categoryId: string | null) => {
    startTransition(async () => {
      await bulkUpdateInlineAction([{ ids: [txId], categoryId }]);
      onOpenChange(false);
      setQuery("");
      setActiveIndex(0);
      onChanged?.();
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (ranked.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % ranked.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + ranked.length) % ranked.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cat = ranked[activeIndex];
      if (cat) apply(cat.id);
    }
  };

  // Mantém a opção destacada visível ao navegar com teclado.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mudar categoria</DialogTitle>
          <DialogDescription>
            Busque pelo nome (acentos e palavras parciais funcionam).
          </DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          placeholder="Buscar…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={pending}
        />

        <div className="max-h-80 overflow-auto rounded-md border">
          {ranked.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground text-center">
              Nenhuma categoria encontrada.
            </p>
          ) : (
            <ul className="divide-y" ref={listRef}>
              {ranked.map((cat, idx) => {
                const isCurrent = cat.id === currentCategoryId;
                const isActive = idx === activeIndex;
                return (
                  <li key={cat.id} data-index={idx}>
                    <button
                      type="button"
                      onClick={() => apply(cat.id)}
                      onMouseEnter={() => setActiveIndex(idx)}
                      disabled={pending}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-3 py-2 text-left",
                        isActive && "bg-muted/60",
                        !isActive && isCurrent && "bg-muted/30",
                      )}
                    >
                      <span className="inline-flex items-center gap-2 min-w-0">
                        {cat.color ? (
                          <span
                            aria-hidden
                            className="inline-block size-2.5 rounded-full shrink-0"
                            style={{ background: cat.color }}
                          />
                        ) : null}
                        <span className="truncate text-sm">{cat.name}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {cat.kind === "income" ? "receita" : "despesa"}
                        </span>
                      </span>
                      {isCurrent ? (
                        <Check className="size-4 text-muted-foreground shrink-0" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex justify-between">
          <Button
            variant="ghost"
            size="sm"
            disabled={pending || !currentCategoryId}
            onClick={() => apply(null)}
          >
            <X className="size-3" /> Remover categoria
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
