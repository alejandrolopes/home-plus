"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { Link2, PlusCircle } from "lucide-react";
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
import { MoneyInput } from "@/components/ui/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBRL, formatDate, todayISO } from "@/lib/format";
import {
  getInvoicePaymentCandidatesAction,
  linkInvoicePaymentAction,
  payInvoiceAction,
  type PayInvoiceState,
} from "./actions";

type SourceAccount = { id: string; name: string };

type Candidate = {
  id: string;
  amount: string;
  occurredOn: string;
  description: string;
  cleanDescription: string | null;
  paymentMethod: string | null;
  accountId: string;
  accountName: string;
};

type Props = {
  trigger: React.ReactNode;
  invoice: {
    id: string;
    cardName: string;
    periodEnd: string;
    dueDate: string;
    totalAmount: string;
  };
  sourceAccounts: SourceAccount[];
};

export function PayInvoiceDialog({ trigger, invoice, sourceAccounts }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "link">("create");
  const [sourceId, setSourceId] = useState<string>(
    sourceAccounts[0]?.id ?? "",
  );

  const [createState, createAction, createPending] = useActionState<
    PayInvoiceState,
    FormData
  >(payInvoiceAction, null);
  const [linkState, linkAction, linkPending] = useActionState<
    PayInvoiceState,
    FormData
  >(linkInvoicePaymentAction, null);

  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<string>("");

  useEffect(() => {
    if (createState?.success || linkState?.success) setOpen(false);
  }, [createState, linkState]);

  useEffect(() => {
    if (open) {
      setMode("create");
      setSourceId(sourceAccounts[0]?.id ?? "");
      setCandidates(null);
      setCandidateError(null);
      setSelectedCandidate("");
    }
  }, [open, sourceAccounts]);

  useEffect(() => {
    if (mode !== "link" || !open) return;
    if (candidates !== null || candidatesLoading) return;
    setCandidatesLoading(true);
    setCandidateError(null);
    (async () => {
      const r = await getInvoicePaymentCandidatesAction(invoice.id);
      if ("error" in r) {
        setCandidateError(r.error);
      } else {
        setCandidates(r.candidates);
        setSelectedCandidate(r.candidates[0]?.id ?? "");
      }
      setCandidatesLoading(false);
    })();
  }, [mode, open, invoice.id, candidates, candidatesLoading]);

  if (sourceAccounts.length === 0) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={trigger as React.ReactElement} />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sem conta de origem</DialogTitle>
            <DialogDescription>
              Você precisa de uma conta corrente, poupança ou dinheiro pra
              pagar a fatura.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Entendi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const errors = createState?.fieldErrors ?? {};

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pagar fatura</DialogTitle>
          <DialogDescription>
            {invoice.cardName} · vencimento{" "}
            {formatDate(`${invoice.dueDate}T00:00:00`)}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total da fatura</span>
            <span className="font-semibold tabular-nums">
              {formatBRL(invoice.totalAmount)}
            </span>
          </div>
        </div>

        <Tabs
          value={mode}
          onValueChange={(v) => setMode(v === "link" ? "link" : "create")}
        >
          <TabsList className="w-full">
            <TabsTrigger value="create" className="flex-1">
              <PlusCircle className="size-3.5" />
              Criar pagamento
            </TabsTrigger>
            <TabsTrigger value="link" className="flex-1">
              <Link2 className="size-3.5" />
              Vincular existente
            </TabsTrigger>
          </TabsList>

          <TabsContent value="create" className="mt-4">
            <form action={createAction} className="space-y-4">
              <input type="hidden" name="invoiceId" value={invoice.id} />

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="amount">Valor pago</Label>
                  <MoneyInput
                    id="amount"
                    name="amount"
                    defaultValue={invoice.totalAmount}
                    required
                    className="text-right tabular-nums"
                  />
                  {errors.amount ? (
                    <p className="text-xs text-destructive">{errors.amount}</p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="paidOn">Data</Label>
                  <Input
                    id="paidOn"
                    name="paidOn"
                    type="date"
                    defaultValue={todayISO()}
                    required
                  />
                  {errors.paidOn ? (
                    <p className="text-xs text-destructive">{errors.paidOn}</p>
                  ) : null}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sourceAccountId">Pagar a partir de</Label>
                <Select
                  name="sourceAccountId"
                  value={sourceId}
                  onValueChange={(v) => setSourceId(v ?? "")}
                >
                  <SelectTrigger id="sourceAccountId" className="w-full">
                    <SelectValue>
                      {(v) =>
                        sourceAccounts.find((a) => a.id === v)?.name ??
                        "Selecione"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {sourceAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {createState?.error && !createState.fieldErrors ? (
                <p className="text-sm text-destructive">{createState.error}</p>
              ) : null}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={createPending}>
                  {createPending ? "Confirmando..." : "Confirmar pagamento"}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          <TabsContent value="link" className="mt-4">
            <form action={linkAction} className="space-y-4">
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <p className="text-xs text-muted-foreground">
                Selecione uma despesa já registrada na sua conta com o mesmo
                valor da fatura.
              </p>

              {candidatesLoading ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Buscando lançamentos...
                </div>
              ) : candidateError ? (
                <p className="text-sm text-destructive">{candidateError}</p>
              ) : candidates && candidates.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Nenhum lançamento de despesa de{" "}
                  <span className="font-medium">
                    {formatBRL(invoice.totalAmount)}
                  </span>{" "}
                  encontrado em ±60 dias do vencimento. Importe o extrato ou
                  use a aba "Criar pagamento".
                </div>
              ) : candidates ? (
                <div className="space-y-1.5">
                  <Label>Lançamento</Label>
                  <Select
                    name="transactionId"
                    value={selectedCandidate}
                    onValueChange={(v) => setSelectedCandidate(v ?? "")}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {(v) => {
                          const c = candidates.find((x) => x.id === v);
                          if (!c) return "Selecione um lançamento";
                          return `${formatDate(`${c.occurredOn}T00:00:00`)} · ${c.cleanDescription ?? c.description}`;
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {candidates.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <div className="flex flex-col gap-0.5 py-0.5">
                            <span className="font-medium">
                              {c.cleanDescription ?? c.description}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatDate(`${c.occurredOn}T00:00:00`)} ·{" "}
                              {c.accountName} · {formatBRL(c.amount)}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {linkState?.error ? (
                <p className="text-sm text-destructive">{linkState.error}</p>
              ) : null}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={
                    linkPending ||
                    !selectedCandidate ||
                    !candidates ||
                    candidates.length === 0
                  }
                >
                  {linkPending ? "Vinculando..." : "Vincular pagamento"}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
