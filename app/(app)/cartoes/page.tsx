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
import { Wallet } from "lucide-react";
import { listAccounts } from "@/lib/repos/accounts";
import { creditCardOverview, listTransactions } from "@/lib/repos/transactions";
import { formatBRL, formatDate } from "@/lib/format";
import { requireOrganization } from "@/lib/guards";
import { PayCardDialog } from "./pay-card-dialog";

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function monthBounds() {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    from: fmt(new Date(y, m, 1)),
    to: fmt(new Date(y, m + 1, 0)),
    label: `${MONTHS[m]} de ${y}`,
  };
}

export default async function CartoesPage() {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  const { from, to, label } = monthBounds();

  const accounts = await listAccounts(orgId, { ownerId: userId });
  const cards = accounts.filter((a) => a.type === "credit_card");
  const sourceAccounts = accounts
    .filter((a) => a.type !== "credit_card")
    .map((a) => ({ id: a.id, name: a.name }));

  if (cards.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cartões</h1>
          <p className="text-muted-foreground">
            Seus gastos no cartão de crédito.
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

  const data = await Promise.all(
    cards.map(async (card) => {
      const [overview, recent] = await Promise.all([
        creditCardOverview(orgId, card.id, { from, to }),
        listTransactions(
          orgId,
          { accountId: card.id, ownerId: userId },
          { view: "purchase" },
        ),
      ]);
      return { card, overview, recent: recent.slice(0, 12) };
    }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cartões</h1>
        <p className="text-muted-foreground">
          Quanto você gastou e quanto ainda deve em cada cartão.
        </p>
      </div>

      <div className="space-y-6">
        {data.map(({ card, overview, recent }) => {
          const owed = Number(overview.owed);
          return (
            <Card key={card.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-4">
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
                        Gastos em {label}:{" "}
                        <span className="font-medium tabular-nums text-foreground">
                          {formatBRL(overview.monthSpend)}
                        </span>
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-sm text-muted-foreground">
                        Você deve
                      </div>
                      <div
                        className={
                          "text-2xl font-bold tabular-nums " +
                          (owed > 0 ? "text-rose-600" : "text-emerald-600")
                        }
                      >
                        {formatBRL(owed > 0 ? overview.owed : "0.00")}
                      </div>
                    </div>
                    {owed > 0 && sourceAccounts.length > 0 ? (
                      <PayCardDialog
                        cardId={card.id}
                        cardName={card.name}
                        owed={overview.owed}
                        sourceAccounts={sourceAccounts}
                        trigger={
                          <Button size="sm">
                            <Wallet className="size-4" />
                            Pagar cartão
                          </Button>
                        }
                      />
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {recent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhum lançamento ainda.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[110px]">Data</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recent.map((t) => {
                        const isCredit = t.kind === "income";
                        return (
                          <TableRow key={t.id}>
                            <TableCell className="tabular-nums text-sm text-muted-foreground">
                              {formatDate(`${t.displayDate}T00:00:00`)}
                            </TableCell>
                            <TableCell className="text-sm">
                              {t.cleanDescription || t.description}
                              {t.aggregated
                                ? ` (${t.aggregated.installmentCount}x)`
                                : ""}
                            </TableCell>
                            <TableCell
                              className={
                                "text-right tabular-nums font-medium " +
                                (isCredit ? "text-emerald-600" : "")
                              }
                            >
                              {isCredit ? "+" : ""}
                              {formatBRL(t.amount)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
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
