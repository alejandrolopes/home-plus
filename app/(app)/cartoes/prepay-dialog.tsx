"use client";

import { useEffect, useMemo, useState } from "react";
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
import { MoneyInput } from "@/components/ui/money-input";
import { Label } from "@/components/ui/label";
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
  getPrepayCandidatesAction,
  linkPrepayInstallmentsAction,
  prepayInstallmentsAction,
  type PrepayCandidate,
  type PrepayState,
} from "./actions";

type PurchaseGroup = {
  key: string;
  description: string;
  pendingAmount: string;
  pendingCount: number;
  installmentTotal: number | null;
  parcelIds: string[];
  earliestInvoicePeriodEnd: string;
  purchaseDate: string;
};

type SortKey = "purchase" | "date" | "amount";
type SortDir = "asc" | "desc";

type SourceAccount = { id: string; name: string };

type Props = {
  trigger: React.ReactNode;
  cardId: string;
  cardName: string;
  purchases: PurchaseGroup[];
  sourceAccounts: SourceAccount[];
};

function toCents(v: string): number {
  return Math.round(Number(v.replace(",", ".")) * 100);
}

export function PrepayDialog({
  trigger,
  cardId,
  cardName,
  purchases,
  sourceAccounts,
}: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "link">("create");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paidAmount, setPaidAmount] = useState<string>("");
  const [sourceId, setSourceId] = useState<string>(
    sourceAccounts[0]?.id ?? "",
  );
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sortedPurchases = useMemo(() => {
    const arr = [...purchases];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "purchase") {
        cmp = a.description.localeCompare(b.description, "pt-BR");
      } else if (sortKey === "date") {
        cmp = a.purchaseDate.localeCompare(b.purchaseDate);
      } else {
        cmp = Number(a.pendingAmount) - Number(b.pendingAmount);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [purchases, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "amount" ? "desc" : "asc");
    }
  };

  const [createState, createAction, createPending] = useActionState<
    PrepayState,
    FormData
  >(prepayInstallmentsAction, null);
  const [linkState, linkAction, linkPending] = useActionState<
    PrepayState,
    FormData
  >(linkPrepayInstallmentsAction, null);

  const [candidates, setCandidates] = useState<PrepayCandidate[] | null>(null);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<string>("");

  useEffect(() => {
    if (createState?.success || linkState?.success) setOpen(false);
  }, [createState, linkState]);

  useEffect(() => {
    if (open) {
      setMode("create");
      setSelected(new Set());
      setPaidAmount("");
      setSourceId(sourceAccounts[0]?.id ?? "");
      setCandidates(null);
      setCandidateError(null);
      setSelectedCandidate("");
    }
  }, [open, sourceAccounts]);

  const nominalCents = useMemo(() => {
    let total = 0;
    for (const k of selected) {
      const g = purchases.find((x) => x.key === k);
      if (g) total += toCents(g.pendingAmount);
    }
    return total;
  }, [selected, purchases]);

  const selectedParcelIds = useMemo(() => {
    const ids: string[] = [];
    for (const k of selected) {
      const g = purchases.find((x) => x.key === k);
      if (g) ids.push(...g.parcelIds);
    }
    return ids;
  }, [selected, purchases]);

  // Reset candidates quando seleção muda na aba link
  useEffect(() => {
    if (mode === "link") {
      setCandidates(null);
      setSelectedCandidate("");
    }
  }, [selectedParcelIds, mode]);

  // Carrega candidatos sob demanda
  useEffect(() => {
    if (mode !== "link" || !open) return;
    if (selectedParcelIds.length === 0) return;
    if (candidates !== null || candidatesLoading) return;
    setCandidatesLoading(true);
    setCandidateError(null);
    (async () => {
      const r = await getPrepayCandidatesAction(cardId, selectedParcelIds);
      if ("error" in r) {
        setCandidateError(r.error);
      } else {
        setCandidates(r.candidates);
        setSelectedCandidate(r.candidates[0]?.id ?? "");
      }
      setCandidatesLoading(false);
    })();
  }, [
    mode,
    open,
    cardId,
    selectedParcelIds,
    candidates,
    candidatesLoading,
  ]);

  const nominal = (nominalCents / 100).toFixed(2);
  const paidCents = paidAmount ? toCents(paidAmount) : nominalCents;
  const discountCents = nominalCents - paidCents;
  const discount = (Math.max(discountCents, 0) / 100).toFixed(2);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const errors = createState?.fieldErrors ?? {};
  const canSubmitCreate =
    selected.size > 0 && sourceAccounts.length > 0 && !createPending;
  const canSubmitLink =
    selected.size > 0 &&
    !!selectedCandidate &&
    !linkPending &&
    !!candidates &&
    candidates.length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Antecipar compra — {cardName}</DialogTitle>
          <DialogDescription>
            Quita compras inteiras agora. As parcelas pendentes saem das
            próximas faturas.
          </DialogDescription>
        </DialogHeader>

        {purchases.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma compra pendente neste cartão.
          </div>
        ) : (
          <>
            {/* Seleção de parcelas (compartilhado entre as duas abas) */}
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

            <div className="rounded-md border max-h-60 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left font-normal px-2 py-1.5 w-8" />
                    <th
                      className="text-left font-normal px-2 py-1.5 cursor-pointer select-none hover:text-foreground"
                      onClick={() => handleSort("purchase")}
                    >
                      Compra
                      {sortKey === "purchase"
                        ? sortDir === "asc"
                          ? " ↑"
                          : " ↓"
                        : ""}
                    </th>
                    <th
                      className="text-left font-normal px-2 py-1.5 cursor-pointer select-none hover:text-foreground w-24"
                      onClick={() => handleSort("date")}
                    >
                      Data
                      {sortKey === "date"
                        ? sortDir === "asc"
                          ? " ↑"
                          : " ↓"
                        : ""}
                    </th>
                    <th
                      className="text-right font-normal px-2 py-1.5 cursor-pointer select-none hover:text-foreground"
                      onClick={() => handleSort("amount")}
                    >
                      Valor
                      {sortKey === "amount"
                        ? sortDir === "asc"
                          ? " ↑"
                          : " ↓"
                        : ""}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPurchases.map((p) => {
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
                        <td className="px-2 py-1.5 text-xs tabular-nums text-muted-foreground">
                          {formatDate(`${p.purchaseDate}T00:00:00`)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                          {formatBRL(p.pendingAmount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
                  <input type="hidden" name="cardId" value={cardId} />
                  {selectedParcelIds.map((id) => (
                    <input
                      key={id}
                      type="hidden"
                      name="transactionIds"
                      value={id}
                    />
                  ))}

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
                        A pagar
                      </div>
                      <div className="tabular-nums font-semibold">
                        {formatBRL((paidCents / 100).toFixed(2))}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="amount">Valor pago</Label>
                      <MoneyInput
                        id="amount"
                        name="amount"
                        defaultValue={paidAmount || nominal}
                        onValueChange={(v) => setPaidAmount(v)}
                        required
                        className="text-right tabular-nums"
                      />
                      {errors.amount ? (
                        <p className="text-xs text-destructive">
                          {errors.amount}
                        </p>
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
                    <p className="text-sm text-destructive">
                      {createState.error}
                    </p>
                  ) : null}

                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setOpen(false)}
                    >
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={!canSubmitCreate}>
                      {createPending ? "Confirmando..." : "Antecipar e pagar"}
                    </Button>
                  </DialogFooter>
                </form>
              </TabsContent>

              <TabsContent value="link" className="mt-4">
                <form action={linkAction} className="space-y-4">
                  <input type="hidden" name="cardId" value={cardId} />
                  {selectedParcelIds.map((id) => (
                    <input
                      key={id}
                      type="hidden"
                      name="transactionIds"
                      value={id}
                    />
                  ))}

                  <p className="text-xs text-muted-foreground">
                    Selecione um lançamento de despesa já existente em conta
                    bancária pra marcar como antecipação destas parcelas.
                  </p>

                  {selected.size === 0 ? (
                    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      Selecione as parcelas a antecipar acima.
                    </div>
                  ) : candidatesLoading ? (
                    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      Buscando lançamentos...
                    </div>
                  ) : candidateError ? (
                    <p className="text-sm text-destructive">{candidateError}</p>
                  ) : candidates && candidates.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      Nenhum lançamento compatível encontrado nos últimos 90
                      dias com valor entre 50% e 110% de{" "}
                      <span className="font-medium">{formatBRL(nominal)}</span>.
                      Importe o extrato ou use a aba "Criar pagamento".
                    </div>
                  ) : candidates ? (
                    <>
                      <div className="space-y-1.5">
                        <Label>Lançamento</Label>
                        <Select
                          name="transactionId"
                          value={selectedCandidate}
                          onValueChange={(v) =>
                            setSelectedCandidate(v ?? "")
                          }
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
                                    {formatDate(
                                      `${c.occurredOn}T00:00:00`,
                                    )}{" "}
                                    · {c.accountName} · {formatBRL(c.amount)}
                                  </span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {selectedCandidate ? (
                        (() => {
                          const c = candidates.find(
                            (x) => x.id === selectedCandidate,
                          );
                          if (!c) return null;
                          const paid = toCents(c.amount);
                          const disc = Math.max(nominalCents - paid, 0);
                          return (
                            <div className="rounded-md border bg-muted/30 p-3 grid grid-cols-3 gap-3 text-sm">
                              <div>
                                <div className="text-xs text-muted-foreground">
                                  Nominal
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
                                  className={`tabular-nums font-medium ${disc > 0 ? "text-emerald-600" : ""}`}
                                >
                                  {disc > 0 ? "−" : ""}
                                  {formatBRL((disc / 100).toFixed(2))}
                                </div>
                              </div>
                              <div>
                                <div className="text-xs text-muted-foreground">
                                  Pago
                                </div>
                                <div className="tabular-nums font-semibold">
                                  {formatBRL(c.amount)}
                                </div>
                              </div>
                            </div>
                          );
                        })()
                      ) : null}
                    </>
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
                    <Button type="submit" disabled={!canSubmitLink}>
                      {linkPending ? "Vinculando..." : "Vincular antecipação"}
                    </Button>
                  </DialogFooter>
                </form>
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
