"use client";

import { useEffect, useState, useTransition } from "react";
import { useActionState } from "react";
import { ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  getInvoiceDetailsAction,
  updateInvoiceDatesAction,
  type InvoiceDetails,
} from "./actions";

type Props = {
  trigger: React.ReactNode;
  invoice: {
    id: string;
    periodStart: string;
    periodEnd: string;
    dueDate: string;
    totalAmount: string;
    cardName: string;
  };
};

export function InvoiceDetailsDialog({ trigger, invoice }: Props) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<InvoiceDetails | null>(null);
  const [loading, startTransition] = useTransition();
  const [periodStart, setPeriodStart] = useState(invoice.periodStart);
  const [periodEnd, setPeriodEnd] = useState(invoice.periodEnd);
  const [dueDate, setDueDate] = useState(invoice.dueDate);

  const [updateState, updateAction, updatePending] = useActionState<
    { error?: string; success?: boolean },
    FormData
  >(updateInvoiceDatesAction, {});

  useEffect(() => {
    if (!open) return;
    startTransition(async () => {
      const result = await getInvoiceDetailsAction(invoice.id);
      if (result) {
        setDetails(result);
        setPeriodStart(result.periodStart);
        setPeriodEnd(result.periodEnd);
        setDueDate(result.dueDate);
      }
    });
  }, [open, invoice.id]);

  useEffect(() => {
    if (updateState?.success) {
      // Refetch para refletir as datas atualizadas
      startTransition(async () => {
        const result = await getInvoiceDetailsAction(invoice.id);
        if (result) setDetails(result);
      });
    }
  }, [updateState, invoice.id]);

  const txs = details?.transactions ?? [];
  const sumCents = txs.reduce((acc, t) => {
    const c = Math.round(Number(t.amount) * 100);
    return acc + (t.kind === "income" ? -c : c);
  }, 0);
  const computedTotal = (sumCents / 100).toFixed(2);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="max-w-5xl w-[90vw]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="size-4" />
            Detalhes da fatura · {invoice.cardName}
          </DialogTitle>
          <DialogDescription>
            Confira os lançamentos e ajuste período/vencimento se necessário.
          </DialogDescription>
        </DialogHeader>

        <form action={updateAction} className="space-y-3">
          <input type="hidden" name="invoiceId" value={invoice.id} />
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="periodStart" className="text-xs">
                Início do período
              </Label>
              <Input
                id="periodStart"
                name="periodStart"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="periodEnd" className="text-xs">
                Fim do período
              </Label>
              <Input
                id="periodEnd"
                name="periodEnd"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dueDate" className="text-xs">
                Vencimento
              </Label>
              <Input
                id="dueDate"
                name="dueDate"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
              />
            </div>
          </div>
          {updateState?.error ? (
            <p className="text-xs text-destructive">{updateState.error}</p>
          ) : null}
          {updateState?.success ? (
            <p className="text-xs text-emerald-700 dark:text-emerald-500">
              Datas atualizadas.
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={updatePending}>
              {updatePending ? "Salvando..." : "Salvar datas"}
            </Button>
          </div>
        </form>

        <div className="rounded-md border max-h-[24rem] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Compra</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && txs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-sm text-muted-foreground py-6"
                  >
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : txs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-sm text-muted-foreground py-6"
                  >
                    Nenhum lançamento nesta fatura.
                  </TableCell>
                </TableRow>
              ) : (
                txs.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="tabular-nums text-xs text-muted-foreground">
                      {formatDate(`${t.purchaseDate ?? t.occurredOn}T00:00:00`)}
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>{t.cleanDescription || t.description}</span>
                        {t.installmentNumber != null ? (
                          <Badge variant="secondary" className="text-[10px]">
                            {t.installmentNumber}/{t.installmentTotal}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {t.categoryName ? (
                        <span className="inline-flex items-center gap-1.5">
                          {t.categoryColor ? (
                            <span
                              aria-hidden
                              className="inline-block size-2 rounded-full"
                              style={{ background: t.categoryColor }}
                            />
                          ) : null}
                          <span>{t.categoryName}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground italic">
                          sem categoria
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums font-medium",
                        t.kind === "income"
                          ? "text-emerald-600"
                          : "text-rose-600",
                      )}
                    >
                      {t.kind === "income" ? "−" : ""}
                      {formatBRL(t.amount)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between text-sm pt-2 border-t flex-wrap gap-2">
          <span className="text-muted-foreground">
            {txs.length} lançamento{txs.length === 1 ? "" : "s"} · soma{" "}
            <span className="font-medium tabular-nums">
              {formatBRL(computedTotal)}
            </span>
          </span>
          {(() => {
            const total = details?.totalAmount ?? invoice.totalAmount;
            const paid = details?.paidAmount ?? "0";
            const balCents =
              Math.round(Number(total) * 100) -
              Math.round(Number(paid) * 100);
            const balance = (balCents / 100).toFixed(2);
            return (
              <span className="text-muted-foreground flex items-center gap-3">
                <span>
                  Total:{" "}
                  <span className="font-medium tabular-nums">
                    {formatBRL(total)}
                  </span>
                </span>
                <span>
                  Pago:{" "}
                  <span className="font-medium tabular-nums">
                    {formatBRL(paid)}
                  </span>
                </span>
                <span>
                  Saldo:{" "}
                  <span
                    className={cn(
                      "font-medium tabular-nums",
                      balCents === 0
                        ? "text-emerald-600"
                        : balCents < 0
                          ? "text-amber-600"
                          : "",
                    )}
                  >
                    {formatBRL(balance)}
                  </span>
                </span>
              </span>
            );
          })()}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
