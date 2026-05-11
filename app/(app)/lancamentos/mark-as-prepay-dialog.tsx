"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBRL } from "@/lib/format";
import {
  getCardsWithPendingsAction,
  linkPrepayInstallmentsAction,
  type CardWithPendings,
  type PrepayState,
} from "../cartoes/actions";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ID do lançamento da conta corrente que vai virar a antecipação. */
  transactionId: string;
  /** Valor do lançamento, mostrado no header. */
  amount: string;
};

function toCents(v: string): number {
  return Math.round(Number(v.replace(",", ".")) * 100);
}

export function MarkAsCardPrepayDialog({
  open,
  onOpenChange,
  transactionId,
  amount,
}: Props) {
  const [cards, setCards] = useState<CardWithPendings[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cardId, setCardId] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [state, action, pending] = useActionState<PrepayState, FormData>(
    linkPrepayInstallmentsAction,
    null,
  );

  useEffect(() => {
    if (state?.success) onOpenChange(false);
  }, [state, onOpenChange]);

  // Carrega cartões + pendências quando abre
  useEffect(() => {
    if (!open) return;
    setCards(null);
    setError(null);
    setCardId("");
    setSelected(new Set());
    setLoading(true);
    (async () => {
      try {
        const r = await getCardsWithPendingsAction();
        setCards(r.cards);
        if (r.cards.length === 1) setCardId(r.cards[0].id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao buscar cartões.");
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  const card = useMemo(
    () => cards?.find((c) => c.id === cardId) ?? null,
    [cards, cardId],
  );

  // Reset seleção quando troca de cartão
  useEffect(() => {
    setSelected(new Set());
  }, [cardId]);

  const nominalCents = useMemo(() => {
    if (!card) return 0;
    let total = 0;
    for (const k of selected) {
      const g = card.purchases.find((p) => p.key === k);
      if (g) total += toCents(g.pendingAmount);
    }
    return total;
  }, [selected, card]);

  const selectedParcelIds = useMemo(() => {
    if (!card) return [];
    const ids: string[] = [];
    for (const k of selected) {
      const g = card.purchases.find((p) => p.key === k);
      if (g) ids.push(...g.parcelIds);
    }
    return ids;
  }, [selected, card]);

  const paidCents = toCents(amount);
  const discountCents = Math.max(nominalCents - paidCents, 0);
  const nominal = (nominalCents / 100).toFixed(2);
  const discount = (discountCents / 100).toFixed(2);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const canSubmit = !!card && selected.size > 0 && !pending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Marcar como antecipação de cartão</DialogTitle>
          <DialogDescription>
            Use este lançamento de {formatBRL(amount)} pra quitar parcelas
            pendentes de um cartão. As parcelas selecionadas saem das próximas
            faturas.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Carregando cartões...
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !cards || cards.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Você não tem cartões com parcelas pendentes.
          </div>
        ) : (
          <form action={action} className="space-y-4">
            <input type="hidden" name="cardId" value={cardId} />
            <input type="hidden" name="transactionId" value={transactionId} />
            {selectedParcelIds.map((id) => (
              <input
                key={id}
                type="hidden"
                name="transactionIds"
                value={id}
              />
            ))}

            {cards.length > 1 ? (
              <div className="space-y-1.5">
                <Label htmlFor="card-select">Cartão</Label>
                <Select
                  value={cardId}
                  onValueChange={(v) => setCardId(v ?? "")}
                >
                  <SelectTrigger id="card-select" className="w-full">
                    <SelectValue>
                      {(v) =>
                        cards.find((c) => c.id === v)?.name ??
                        "Selecione um cartão"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {cards.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <div className="flex items-center gap-2">
                          {c.color ? (
                            <span
                              aria-hidden
                              className="size-2 rounded-full"
                              style={{ backgroundColor: c.color }}
                            />
                          ) : null}
                          {c.name}
                          <span className="text-xs text-muted-foreground">
                            ({c.purchases.length} compra
                            {c.purchases.length === 1 ? "" : "s"})
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {card ? (
              <>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {selected.size} de {card.purchases.length} compra
                    {card.purchases.length === 1 ? "" : "s"} selecionada
                    {selected.size === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="rounded-md border max-h-60 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="text-left font-normal px-2 py-1.5 w-8" />
                        <th className="text-left font-normal px-2 py-1.5">
                          Compra
                        </th>
                        <th className="text-right font-normal px-2 py-1.5">
                          Valor
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {card.purchases.map((p) => {
                        const checked = selected.has(p.key);
                        return (
                          <tr
                            key={p.key}
                            className={`border-b last:border-b-0 hover:bg-muted/40 cursor-pointer ${checked ? "bg-muted/40" : ""}`}
                            onClick={() => toggle(p.key)}
                          >
                            <td className="px-2 py-1.5">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggle(p.key)}
                                onClick={(e) => e.stopPropagation()}
                                className="size-4 accent-primary"
                              />
                            </td>
                            <td className="px-2 py-1.5">{p.description}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                              {formatBRL(p.pendingAmount)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="rounded-md border bg-muted/30 p-3 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Soma nominal
                    </div>
                    <div className="tabular-nums font-medium">
                      {formatBRL(nominal)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Desconto
                    </div>
                    <div
                      className={`tabular-nums font-medium ${discountCents > 0 ? "text-emerald-600" : ""}`}
                    >
                      {discountCents > 0 ? "−" : ""}
                      {formatBRL(discount)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Pago (este lançamento)
                    </div>
                    <div className="tabular-nums font-semibold">
                      {formatBRL(amount)}
                    </div>
                  </div>
                </div>
              </>
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
              <Button type="submit" disabled={!canSubmit}>
                {pending ? "Vinculando..." : "Vincular antecipação"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
