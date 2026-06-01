"use client";

import { useActionState, useState } from "react";
import { ChevronDown, ChevronRight, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatBRL, formatDate } from "@/lib/format";
import type { AppliedPrepayment } from "@/lib/repos/invoices";
import { unlinkPrepaymentAction } from "./actions";

type Props = {
  applied: AppliedPrepayment[];
};

export function AppliedPrepaymentsSection({ applied }: Props) {
  const [open, setOpen] = useState(false);
  if (applied.length === 0) return null;
  return (
    <Card className="border-emerald-300">
      <CardHeader>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <div className="flex items-center gap-2">
            {open ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
            <CardTitle className="text-base">Antecipações aplicadas</CardTitle>
            <Badge variant="secondary">{applied.length}</Badge>
          </div>
        </button>
        {open ? (
          <CardDescription>
            Pagamentos vinculados a faturas. Use "Desfazer" se o vínculo foi
            para a fatura errada.
          </CardDescription>
        ) : null}
      </CardHeader>
      {open ? (
        <CardContent className="space-y-3">
          {applied.map((p) => (
            <AppliedRow key={p.id} prepayment={p} />
          ))}
        </CardContent>
      ) : null}
    </Card>
  );
}

function AppliedRow({ prepayment }: { prepayment: AppliedPrepayment }) {
  const [state, action, pending] = useActionState<
    { error?: string; success?: boolean },
    FormData
  >(unlinkPrepaymentAction, {});

  const dotColor = prepayment.accountColor ?? "#94a3b8";

  return (
    <form
      action={action}
      className="flex flex-col md:flex-row md:items-center gap-3 rounded-md border p-3 bg-background"
    >
      <input type="hidden" name="transactionId" value={prepayment.id} />

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
          {formatDate(`${prepayment.occurredOn}T00:00:00`)} · R${" "}
          {formatBRL(prepayment.amount)}
        </div>
        <div className="text-xs mt-1">
          <span className="text-muted-foreground">Abateu da fatura:</span>{" "}
          <span className="font-medium">{prepayment.invoiceCardName}</span> ·
          venc. {formatDate(`${prepayment.invoiceDueDate}T00:00:00`)} · saldo
          atual R$ {formatBRL(prepayment.invoiceTotalAmount)}
          {prepayment.invoiceStatus === "paid" ? (
            <span className="ml-1 text-emerald-700 dark:text-emerald-500">
              (paga)
            </span>
          ) : null}
        </div>
      </div>

      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending}
        className="self-start md:self-auto"
      >
        <Undo2 className="size-3.5" />
        {pending ? "Desfazendo..." : "Desfazer"}
      </Button>

      {state?.error ? (
        <div className="text-xs text-destructive md:basis-full">
          {state.error}
        </div>
      ) : null}
    </form>
  );
}
