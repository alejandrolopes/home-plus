"use client";

import { useActionState, useState } from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBRL, formatDate } from "@/lib/format";
import type {
  OpenInvoiceForApply,
  OrphanPrepayment,
} from "@/lib/repos/invoices";
import { applyPrepaymentToInvoiceAction } from "./actions";

type Props = {
  prepayments: OrphanPrepayment[];
  openInvoices: OpenInvoiceForApply[];
};

export function OrphanPrepaymentsSection({ prepayments, openInvoices }: Props) {
  if (prepayments.length === 0) return null;

  return (
    <Card className="border-amber-300">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="size-4 text-amber-600" />
          Antecipações detectadas, ainda não aplicadas
        </CardTitle>
        <CardDescription>
          Foram vinculadas ao OFX do cartão durante a importação, mas o valor
          ainda não foi abatido da fatura aberta. Escolha a fatura e aplique.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {prepayments.map((p) => (
          <OrphanRow
            key={p.id}
            prepayment={p}
            openInvoices={openInvoices}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function OrphanRow({
  prepayment,
  openInvoices,
}: {
  prepayment: OrphanPrepayment;
  openInvoices: OpenInvoiceForApply[];
}) {
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>(
    openInvoices[0]?.id ?? "",
  );
  const [state, action, pending] = useActionState<
    { error?: string; success?: boolean },
    FormData
  >(applyPrepaymentToInvoiceAction, {});

  const dotColor = prepayment.accountColor ?? "#94a3b8";

  return (
    <form
      action={action}
      className="flex flex-col md:flex-row md:items-center gap-3 rounded-md border p-3 bg-background"
    >
      <input
        type="hidden"
        name="transactionId"
        value={prepayment.id}
      />
      <input type="hidden" name="invoiceId" value={selectedInvoiceId} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            aria-hidden
            className="inline-block size-2 rounded-full"
            style={{ background: dotColor }}
          />
          <span className="text-sm font-medium truncate">
            {prepayment.cleanDescription || prepayment.description}
          </span>
          <Badge variant="outline" className="text-[10px]">
            {prepayment.accountName}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {formatDate(`${prepayment.occurredOn}T00:00:00`)} · R$ {formatBRL(prepayment.amount)}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {openInvoices.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            Nenhuma fatura aberta para aplicar
          </span>
        ) : (
          <>
            <Select
              value={selectedInvoiceId}
              onValueChange={(v) => setSelectedInvoiceId(v ?? "")}
            >
              <SelectTrigger className="h-8 text-xs min-w-[220px]">
                <SelectValue>
                  {(v) => {
                    const inv = openInvoices.find((i) => i.id === v);
                    if (!inv) return "Selecione fatura";
                    return (
                      <span className="truncate">
                        {inv.cardName} ·{" "}
                        {formatDate(`${inv.dueDate}T00:00:00`)} ·{" "}
                        R$ {formatBRL(inv.totalAmount)}
                      </span>
                    );
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {openInvoices.map((inv) => (
                  <SelectItem key={inv.id} value={inv.id}>
                    <span className="text-xs">
                      {inv.cardName} · venc. {formatDate(`${inv.dueDate}T00:00:00`)}
                      {" · "}
                      R$ {formatBRL(inv.totalAmount)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="submit"
              size="sm"
              disabled={pending || !selectedInvoiceId}
            >
              {pending ? "Aplicando..." : "Aplicar"}
            </Button>
          </>
        )}
      </div>

      {state?.error ? (
        <div className="text-xs text-destructive md:basis-full">
          {state.error}
        </div>
      ) : null}
    </form>
  );
}
