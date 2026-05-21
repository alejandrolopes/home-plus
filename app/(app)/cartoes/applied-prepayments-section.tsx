"use client";

import { useActionState } from "react";
import { Undo2 } from "lucide-react";
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
  if (applied.length === 0) return null;
  return (
    <Card className="border-emerald-300">
      <CardHeader>
        <CardTitle className="text-base">Antecipações aplicadas</CardTitle>
        <CardDescription>
          Pagamentos vinculados a faturas. Use "Desfazer" se o vínculo foi
          para a fatura errada.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {applied.map((p) => (
          <AppliedRow key={p.id} prepayment={p} />
        ))}
      </CardContent>
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
