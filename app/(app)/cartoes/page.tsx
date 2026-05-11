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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listAccounts } from "@/lib/repos/accounts";
import {
  getNextOpenInvoice,
  listInvoicesByCard,
  listLinkableInvoicesForCard,
  listLinkablePaymentTransactions,
  listPendingPayments,
  listPendingPurchasesForCard,
  type LinkableInvoice,
  type LinkablePaymentTx,
} from "@/lib/repos/invoices";
import { formatBRL, formatDate } from "@/lib/format";
import { requireOrganization } from "@/lib/guards";
import { PayInvoiceDialog } from "./pay-invoice-dialog";
import { PrepayDialog } from "./prepay-dialog";
import { ConsolidateDialog } from "./consolidate-dialog";
import { PendingPaymentsSection } from "./pending-payments-section";
import { CalendarClock, Sparkles } from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  open: "Aberta",
  closed: "Fechada",
  paid: "Paga",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  open: "default",
  closed: "secondary",
  paid: "outline",
};

export default async function CartoesPage() {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const [accounts, invoices, pendings] = await Promise.all([
    listAccounts(orgId, { ownerId: userId }),
    listInvoicesByCard(orgId, { ownerId: userId }),
    listPendingPayments(orgId, { ownerId: userId }),
  ]);

  const linkableByAccount: Record<string, LinkableInvoice[]> = {};
  const paymentTxsByAmount: Record<string, LinkablePaymentTx[]> = {};
  for (const p of pendings) {
    if (!linkableByAccount[p.accountId]) {
      linkableByAccount[p.accountId] = await listLinkableInvoicesForCard(
        orgId,
        p.accountId,
      );
    }
    const cacheKey = `${p.amount}:${p.occurredOn}`;
    if (!paymentTxsByAmount[cacheKey]) {
      paymentTxsByAmount[cacheKey] = await listLinkablePaymentTransactions(
        orgId,
        p.amount,
        { occurredOn: p.occurredOn },
      );
    }
  }

  const cards = accounts.filter((a) => a.type === "credit_card");
  const sourceAccounts = accounts
    .filter((a) => a.type !== "credit_card")
    .map((a) => ({ id: a.id, name: a.name }));

  const purchasesByCard = new Map<
    string,
    Awaited<ReturnType<typeof listPendingPurchasesForCard>>
  >();
  const nextInvoiceByCard = new Map<
    string,
    Awaited<ReturnType<typeof getNextOpenInvoice>>
  >();
  for (const card of cards) {
    const nextInv = await getNextOpenInvoice(orgId, card.id);
    nextInvoiceByCard.set(card.id, nextInv);
    purchasesByCard.set(
      card.id,
      await listPendingPurchasesForCard(orgId, card.id, {
        afterPeriodEnd: nextInv?.periodEnd,
      }),
    );
  }

  if (cards.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cartões</h1>
          <p className="text-muted-foreground">
            Faturas de cartão de crédito.
          </p>
        </div>
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">
            Nenhum cartão de crédito cadastrado.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cartões</h1>
        <p className="text-muted-foreground">
          Faturas dos cartões de crédito da família.
        </p>
      </div>

      <PendingPaymentsSection
        pendings={pendings.map((p) => ({
          id: p.id,
          accountId: p.accountId,
          accountName: p.accountName,
          accountColor: p.accountColor,
          amount: p.amount,
          occurredOn: p.occurredOn,
          rawDescription: p.rawDescription,
          source: p.source,
        }))}
        invoicesByAccount={linkableByAccount}
        paymentTxsByAmount={paymentTxsByAmount}
      />

      <div className="space-y-6">
        {cards.map((card) => {
          const cardInvoices = invoices.filter((i) => i.accountId === card.id);
          const usedCents = cardInvoices
            .filter((i) => i.status !== "paid")
            .reduce(
              (acc, i) => acc + Math.round(Number(i.totalAmount) * 100),
              0,
            );
          const used = (usedCents / 100).toFixed(2);
          const limit = card.creditLimit ? Number(card.creditLimit) : null;
          const utilization = limit
            ? Math.min(100, Math.round((Number(used) / limit) * 100))
            : null;

          return (
            <Card key={card.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    {card.color ? (
                      <span
                        className="inline-block size-4 rounded-full"
                        style={{ backgroundColor: card.color }}
                      />
                    ) : null}
                    <div>
                      <CardTitle>{card.name}</CardTitle>
                      <CardDescription>
                        Fechamento dia {card.closingDay} · Vencimento dia{" "}
                        {card.dueDay}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {(() => {
                      const purchases = purchasesByCard.get(card.id) ?? [];
                      const nextInv = nextInvoiceByCard.get(card.id);
                      const singlePurchases = purchases.filter(
                        (p) => p.installmentTotal == null,
                      );
                      const consolidatable = purchases.filter(
                        (p) =>
                          p.installmentTotal != null &&
                          p.futurePendingCount > 0,
                      );

                      return (
                        <>
                          {singlePurchases.length > 0 ? (
                            <PrepayDialog
                              cardId={card.id}
                              cardName={card.name}
                              purchases={singlePurchases}
                              sourceAccounts={sourceAccounts}
                              trigger={
                                <Button variant="outline" size="sm">
                                  <Sparkles className="size-4" />
                                  Antecipar compra
                                </Button>
                              }
                            />
                          ) : null}
                          {consolidatable.length > 0 && nextInv ? (
                            <ConsolidateDialog
                              cardId={card.id}
                              cardName={card.name}
                              purchases={consolidatable}
                              nextInvoice={{
                                periodEnd: nextInv.periodEnd,
                                dueDate: nextInv.dueDate,
                              }}
                              trigger={
                                <Button variant="outline" size="sm">
                                  <CalendarClock className="size-4" />
                                  Antecipar parcelas
                                </Button>
                              }
                            />
                          ) : null}
                        </>
                      );
                    })()}
                    <div className="text-right">
                      <div className="text-sm text-muted-foreground">
                        Em aberto
                      </div>
                      <div className="text-2xl font-bold tabular-nums">
                        {formatBRL(used)}
                      </div>
                      {limit ? (
                        <div className="text-xs text-muted-foreground">
                          de {formatBRL(limit)} ({utilization}%)
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {cardInvoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma fatura ainda.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Período</TableHead>
                        <TableHead>Vencimento</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="w-[120px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cardInvoices.map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell className="tabular-nums text-sm">
                            {formatDate(`${inv.periodStart}T00:00:00`)} —{" "}
                            {formatDate(`${inv.periodEnd}T00:00:00`)}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {formatDate(`${inv.dueDate}T00:00:00`)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={STATUS_VARIANT[inv.status]}>
                              {STATUS_LABEL[inv.status]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            {formatBRL(inv.totalAmount)}
                          </TableCell>
                          <TableCell className="text-right">
                            {inv.status !== "paid" &&
                            Number(inv.totalAmount) > 0 ? (
                              <PayInvoiceDialog
                                invoice={{
                                  id: inv.id,
                                  cardName: card.name,
                                  periodEnd: inv.periodEnd,
                                  dueDate: inv.dueDate,
                                  totalAmount: inv.totalAmount,
                                }}
                                sourceAccounts={sourceAccounts}
                                trigger={
                                  <Button variant="outline" size="sm">
                                    Pagar
                                  </Button>
                                }
                              />
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
