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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Label } from "@/components/ui/label";
import { formatBRL, formatDate } from "@/lib/format";
import {
  consolidateInstallmentsAction,
  type ConsolidateState,
} from "./actions";

type PurchaseGroup = {
  key: string;
  description: string;
  installmentTotal: number | null;
  futurePendingAmount: string;
  futurePendingCount: number;
  futureParcelIds: string[];
};

type Props = {
  trigger: React.ReactNode;
  cardId: string;
  cardName: string;
  purchases: PurchaseGroup[];
  nextInvoice: { periodEnd: string; dueDate: string };
};

function toCents(v: string): number {
  return Math.round(Number(v.replace(",", ".")) * 100);
}

export function ConsolidateDialog({
  trigger,
  cardId,
  cardName,
  purchases,
  nextInvoice,
}: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [discount, setDiscount] = useState<string>("0");
  const [state, action, pending] = useActionState<ConsolidateState, FormData>(
    consolidateInstallmentsAction,
    null,
  );

  useEffect(() => {
    if (state?.success) setOpen(false);
  }, [state]);

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setDiscount("0");
    }
  }, [open]);

  const nominalCents = useMemo(() => {
    let total = 0;
    for (const k of selected) {
      const g = purchases.find((x) => x.key === k);
      if (g) total += toCents(g.futurePendingAmount);
    }
    return total;
  }, [selected, purchases]);

  const selectedParcelIds = useMemo(() => {
    const ids: string[] = [];
    for (const k of selected) {
      const g = purchases.find((x) => x.key === k);
      if (g) ids.push(...g.futureParcelIds);
    }
    return ids;
  }, [selected, purchases]);

  const nominal = (nominalCents / 100).toFixed(2);
  const discountCents = discount ? toCents(discount) : 0;
  const consolidatedCents = nominalCents - discountCents;
  const consolidated = (Math.max(consolidatedCents, 0) / 100).toFixed(2);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const errors = state?.fieldErrors ?? {};
  const canSubmit =
    selected.size > 0 &&
    !pending &&
    discountCents < nominalCents &&
    purchases.length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Antecipar parcelas — {cardName}</DialogTitle>
          <DialogDescription>
            Move todas as parcelas futuras das compras selecionadas pra
            próxima fatura (
            <strong>{formatDate(`${nextInvoice.periodEnd}T00:00:00`)}</strong>
            ). Sem débito agora — o pagamento acontece no vencimento da
            fatura. O desconto entra como crédito na conta de origem nesse
            dia.
          </DialogDescription>
        </DialogHeader>

        {purchases.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma compra com parcelas em faturas futuras. (Parcelas da
            próxima fatura não podem ser consolidadas — elas já estão lá.)
          </div>
        ) : (
          <form action={action} className="space-y-4">
            <input type="hidden" name="cardId" value={cardId} />
            {selectedParcelIds.map((id) => (
              <input
                key={id}
                type="hidden"
                name="transactionIds"
                value={id}
              />
            ))}

            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {selected.size} de {purchases.length} compra
                {purchases.length === 1 ? "" : "s"} selecionada
                {selected.size === 1 ? "" : "s"}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSelected(new Set(purchases.map((p) => p.key)))
                }
                disabled={selected.size === purchases.length}
              >
                Selecionar todas
              </Button>
            </div>

            <div className="rounded-md border max-h-72 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left font-normal px-2 py-1.5 w-8" />
                    <th className="text-left font-normal px-2 py-1.5">
                      Compra
                    </th>
                    <th className="text-left font-normal px-2 py-1.5">
                      A consolidar
                    </th>
                    <th className="text-right font-normal px-2 py-1.5">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((p) => {
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
                        <td className="px-2 py-1.5 text-xs text-muted-foreground">
                          {p.futurePendingCount} parcela
                          {p.futurePendingCount === 1 ? "" : "s"}
                          {p.installmentTotal
                            ? ` (de ${p.installmentTotal})`
                            : ""}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                          {formatBRL(p.futurePendingAmount)}
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
                <div className="text-xs text-muted-foreground">Desconto</div>
                <div
                  className={`tabular-nums font-medium ${discountCents > 0 ? "text-emerald-600" : ""}`}
                >
                  {discountCents > 0 ? "−" : ""}
                  {formatBRL((discountCents / 100).toFixed(2))}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  Vai pra próxima fatura
                </div>
                <div className="tabular-nums font-semibold">
                  {formatBRL(consolidated)}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="discount">Desconto</Label>
              <MoneyInput
                id="discount"
                name="discount"
                defaultValue={discount || "0"}
                onValueChange={(v) => setDiscount(v)}
                className="text-right tabular-nums"
              />
              {errors.discount ? (
                <p className="text-xs text-destructive">{errors.discount}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                O desconto será creditado na conta de origem no dia do
                pagamento da fatura{" "}
                {formatDate(`${nextInvoice.periodEnd}T00:00:00`)}.
              </p>
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
              <Button type="submit" disabled={!canSubmit}>
                {pending ? "Consolidando..." : "Consolidar parcelas"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
