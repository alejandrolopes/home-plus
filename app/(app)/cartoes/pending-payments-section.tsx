"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Link2, Trash2 } from "lucide-react";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBRL, formatDate } from "@/lib/format";
import {
  dismissAllPendingsAction,
  dismissPendingPaymentAction,
  linkPendingPaymentAction,
  retryAutoLinkPendingsAction,
} from "./pending-actions";

type PendingItem = {
  id: string;
  accountId: string;
  accountName: string;
  accountColor: string | null;
  amount: string;
  occurredOn: string;
  rawDescription: string;
  source: string;
};

type LinkableInvoice = {
  id: string;
  periodEnd: string;
  dueDate: string;
  totalAmount: string;
};

type LinkablePaymentTx = {
  id: string;
  amount: string;
  occurredOn: string;
  description: string;
  paymentMethod: string;
  accountName: string;
};

type LinkOption =
  | { kind: "invoice"; id: string; label: string; sublabel: string; isExact: boolean }
  | {
      kind: "transaction";
      id: string;
      label: string;
      sublabel: string;
      isExact: boolean;
    };

type Props = {
  pendings: PendingItem[];
  invoicesByAccount: Record<string, LinkableInvoice[]>;
  paymentTxsByAmount: Record<string, LinkablePaymentTx[]>;
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  card_prepay: "Antecipação",
  card_invoice_payment: "Pagamento de fatura",
  fatura_cartao: "Pagamento de fatura",
};

export function PendingPaymentsSection({
  pendings,
  invoicesByAccount,
  paymentTxsByAmount,
}: Props) {
  if (pendings.length === 0) return null;

  return (
    <Card className="border-amber-300 dark:border-amber-700">
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-amber-600" />
              Pendências de pagamento ({pendings.length})
            </CardTitle>
            <CardDescription className="mt-1">
              Pagamentos recebidos pelo extrato sem vínculo. Selecione uma
              fatura paga ou uma transação de antecipação/pagamento, ou descarte.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <RetryAutoLinkButton />
            <DismissAllButton count={pendings.length} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {pendings.map((p) => (
          <PendingRow
            key={p.id}
            item={p}
            invoices={invoicesByAccount[p.accountId] ?? []}
            paymentTxs={paymentTxsByAmount[`${p.amount}:${p.occurredOn}`] ?? []}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function DismissAllButton({ count }: { count: number }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<number | null>(null);
  return (
    <div className="flex items-center gap-2">
      {done !== null ? (
        <span className="text-xs text-muted-foreground">
          {done} descartada{done === 1 ? "" : "s"}
        </span>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending || count === 0}
        onClick={() => {
          if (
            !confirm(
              `Descartar ${count} pendência${count === 1 ? "" : "s"}? Os pagamentos no extrato continuam, só somem desta lista.`,
            )
          )
            return;
          setDone(null);
          startTransition(async () => {
            const r = await dismissAllPendingsAction();
            setDone(r.dismissed);
          });
        }}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
        {pending ? "Descartando..." : "Descartar todas"}
      </Button>
    </div>
  );
}

function RetryAutoLinkButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    linked: number;
    ambiguous: number;
    unmatched: number;
  } | null>(null);
  return (
    <div className="flex items-center gap-2">
      {result ? (
        <span className="text-xs text-muted-foreground">
          {result.linked} vinculadas
          {result.ambiguous > 0 ? ` · ${result.ambiguous} ambíguas` : ""}
          {result.unmatched > 0 ? ` · ${result.unmatched} sem match` : ""}
        </span>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          setResult(null);
          startTransition(async () => {
            const r = await retryAutoLinkPendingsAction();
            setResult(r);
          });
        }}
      >
        {pending ? "Tentando..." : "Tentar auto-vincular"}
      </Button>
    </div>
  );
}

function PendingRow({
  item,
  invoices,
  paymentTxs,
}: {
  item: PendingItem;
  invoices: LinkableInvoice[];
  paymentTxs: LinkablePaymentTx[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const invoiceOptions: LinkOption[] = invoices.map((inv) => ({
    kind: "invoice" as const,
    id: inv.id,
    label: `Fatura ${formatDate(`${inv.periodEnd}T00:00:00`)}`,
    sublabel: formatBRL(inv.totalAmount),
    isExact: inv.totalAmount === item.amount,
  }));
  const txOptions: LinkOption[] = paymentTxs.map((tx) => ({
    kind: "transaction" as const,
    id: tx.id,
    label: `${PAYMENT_METHOD_LABEL[tx.paymentMethod] ?? "Pagamento"} · ${formatDate(`${tx.occurredOn}T00:00:00`)}`,
    sublabel: `${tx.accountName} · ${formatBRL(tx.amount)}`,
    isExact: tx.amount === item.amount,
  }));

  const allOptions = [...invoiceOptions, ...txOptions];
  const exact = allOptions.find((o) => o.isExact);
  const defaultKey = exact
    ? `${exact.kind}:${exact.id}`
    : allOptions[0]
      ? `${allOptions[0].kind}:${allOptions[0].id}`
      : "";

  const [selectedKey, setSelectedKey] = useState<string>(defaultKey);

  const link = () => {
    const key = selectedKey || defaultKey;
    if (!key) return;
    const [kind, id] = key.split(":") as ["invoice" | "transaction", string];
    setError(null);
    startTransition(async () => {
      const r = await linkPendingPaymentAction(item.id, { kind, id });
      if ("error" in r) setError(r.error);
    });
  };

  const dismiss = () => {
    if (!confirm("Descartar esta pendência?")) return;
    setError(null);
    startTransition(async () => {
      const r = await dismissPendingPaymentAction(item.id);
      if ("error" in r) setError(r.error);
    });
  };

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            {item.accountColor ? (
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ backgroundColor: item.accountColor }}
              />
            ) : null}
            <span className="text-sm font-medium">{item.accountName}</span>
            <Badge variant="outline" className="text-[10px] uppercase">
              {item.source}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            {formatDate(`${item.occurredOn}T00:00:00`)} · {item.rawDescription}
          </div>
        </div>
        <div className="text-right tabular-nums font-semibold text-amber-700 dark:text-amber-500">
          {formatBRL(item.amount)}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {allOptions.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            Nenhuma fatura paga ou transação de pagamento compatível. Use
            "Antecipar compra" ou "Pagar fatura" pra criar uma, ou descarte.
          </p>
        ) : (
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
            <Select
              value={selectedKey || defaultKey}
              onValueChange={(v) => setSelectedKey(v ?? "")}
            >
              <SelectTrigger className="w-full text-xs">
                <SelectValue>
                  {(v) => {
                    const opt = allOptions.find(
                      (o) => `${o.kind}:${o.id}` === v,
                    );
                    if (!opt) return "Selecione";
                    return `${opt.label} · ${opt.sublabel}`;
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {invoiceOptions.length > 0 ? (
                  <SelectGroup>
                    <SelectLabel>🧾 Faturas pagas</SelectLabel>
                    {invoiceOptions.map((opt) => (
                      <SelectItem
                        key={`${opt.kind}:${opt.id}`}
                        value={`${opt.kind}:${opt.id}`}
                      >
                        {opt.label} · {opt.sublabel}
                        {opt.isExact ? "  ✓" : ""}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
                {txOptions.length > 0 ? (
                  <SelectGroup>
                    <SelectLabel>💸 Antecipações/Pagamentos</SelectLabel>
                    {txOptions.map((opt) => (
                      <SelectItem
                        key={`${opt.kind}:${opt.id}`}
                        value={`${opt.kind}:${opt.id}`}
                      >
                        {opt.label} · {opt.sublabel}
                        {opt.isExact ? "  ✓" : ""}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={link}
              disabled={pending}
              className="gap-1"
            >
              <Link2 className="size-3.5" />
              Vincular
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={dismiss}
              disabled={pending}
              className="text-muted-foreground hover:text-destructive"
            >
              Descartar
            </Button>
          </div>
        )}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
