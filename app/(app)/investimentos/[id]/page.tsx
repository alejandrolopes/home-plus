import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
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
import { requireOrganization } from "@/lib/guards";
import { isModuleEnabled } from "@/lib/modules";
import { getInvestment } from "@/lib/repos/investments";
import { ConfirmForm } from "@/components/confirm-form";
import {
  listLinkableTransactionsForAport,
  listLinkedTransactions,
} from "@/lib/repos/investments";
import {
  archiveInvestmentFormAction,
  deleteInvestmentFormAction,
  deleteSnapshotFormAction,
  unlinkTransactionFormAction,
} from "../actions";
import { InvestmentFormDialog } from "../investment-form";
import { LinkTransactionDialog } from "../link-transaction-dialog";
import { SnapshotDialog } from "../snapshot-dialog";

const CLASS_LABEL: Record<string, string> = {
  fixed_income: "Renda fixa",
  variable_income: "Renda variável",
};

export default async function InvestmentDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  if (!(await isModuleEnabled(orgId, "investimentos"))) notFound();

  const { id } = await params;
  const inv = await getInvestment(orgId, id);
  if (!inv) notFound();

  if (inv.ownerId !== null && inv.ownerId !== userId) notFound();

  const [linkableTxs, linkedTxs] = await Promise.all([
    listLinkableTransactionsForAport(orgId, userId, { daysBack: 90 }),
    listLinkedTransactions(inv.id),
  ]);

  const color = inv.color ?? "#0ea5e9";
  const balance = inv.currentBalanceCents / 100;
  const applied = inv.totalAppliedCents / 100;
  const lifetimeReturn = inv.currentBalanceCents - inv.totalAppliedCents;
  const pctReturn = applied > 0 ? ((balance - applied) / applied) * 100 : 0;

  // Snapshots vêm desc; pra exibir cronológico crescente, inverte; pra
  // cálculo de rendimento mensal vs anterior, agrupa em ordem desc mesmo.
  const snapshots = inv.snapshots;

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          render={<Link href="/investimentos" />}
          nativeButton={false}
        >
          <ArrowLeft className="size-3.5" /> Voltar
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="h-2" style={{ backgroundColor: color }} aria-hidden />
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-2xl">{inv.productName}</CardTitle>
              <CardDescription className="mt-1">
                {inv.institution}
                {inv.issuer ? ` · ${inv.issuer}` : ""}
              </CardDescription>
              <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                <Badge variant="outline">
                  {CLASS_LABEL[inv.class] ?? inv.class}
                </Badge>
                <Badge variant="outline">
                  {inv.ownerId === null ? "Família" : "Pessoal"}
                </Badge>
                {inv.maturityDate ? (
                  <span>
                    Vence em {formatDate(`${inv.maturityDate}T00:00:00`)}
                  </span>
                ) : null}
                {inv.archived ? (
                  <Badge variant="secondary">Arquivado</Badge>
                ) : null}
              </div>
              {inv.notes ? (
                <p className="text-sm text-muted-foreground mt-2">{inv.notes}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              <InvestmentFormDialog
                investment={{
                  id: inv.id,
                  institution: inv.institution,
                  issuer: inv.issuer,
                  productName: inv.productName,
                  class: inv.class,
                  maturityDate: inv.maturityDate,
                  color: inv.color,
                  notes: inv.notes,
                  ownerId: inv.ownerId,
                }}
                trigger={
                  <Button variant="outline" size="sm">
                    <Pencil className="size-3.5" /> Editar
                  </Button>
                }
              />
              <form action={archiveInvestmentFormAction}>
                <input type="hidden" name="id" value={inv.id} />
                <input
                  type="hidden"
                  name="archived"
                  value={inv.archived ? "false" : "true"}
                />
                <Button type="submit" variant="outline" size="sm">
                  {inv.archived ? "Desarquivar" : "Arquivar"}
                </Button>
              </form>
              <ConfirmForm
                action={deleteInvestmentFormAction}
                message="Apagar este investimento e todos os snapshots? Não dá pra desfazer."
              >
                <input type="hidden" name="id" value={inv.id} />
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </ConfirmForm>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="grid gap-3 md:grid-cols-4 text-sm">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Saldo atual</div>
              <div className="text-lg tabular-nums font-medium">
                {formatBRL(balance.toFixed(2))}
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Aplicado</div>
              <div className="text-lg tabular-nums font-medium">
                {formatBRL(applied.toFixed(2))}
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">
                Rendimento total
              </div>
              <div
                className={`text-lg tabular-nums font-medium ${lifetimeReturn >= 0 ? "text-emerald-600" : "text-rose-600"}`}
              >
                {lifetimeReturn >= 0 ? "+" : "−"}
                {formatBRL((Math.abs(lifetimeReturn) / 100).toFixed(2))}
              </div>
              <div className="text-xs text-muted-foreground">
                ({pctReturn >= 0 ? "+" : ""}
                {pctReturn.toFixed(2)}%)
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">
                Rendimento último mês
              </div>
              <div
                className={`text-lg tabular-nums font-medium ${
                  inv.lastMonthReturnCents === null
                    ? "text-muted-foreground"
                    : inv.lastMonthReturnCents >= 0
                      ? "text-emerald-600"
                      : "text-rose-600"
                }`}
              >
                {inv.lastMonthReturnCents === null
                  ? "—"
                  : `${inv.lastMonthReturnCents >= 0 ? "+" : "−"}${formatBRL((Math.abs(inv.lastMonthReturnCents) / 100).toFixed(2))}`}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">
            Aportes vinculados ({linkedTxs.length})
          </CardTitle>
          <LinkTransactionDialog
            investmentId={inv.id}
            candidates={linkableTxs}
          />
        </CardHeader>
        <CardContent>
          {linkedTxs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma transação vinculada. Use "Vincular transação" pra
              registrar um aporte a partir de uma despesa da sua conta
              corrente — o snapshot do mês é atualizado automaticamente.
            </p>
          ) : (
            <ul className="divide-y">
              {linkedTxs.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-2 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {t.cleanDescription ?? t.description}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(`${t.occurredOn}T00:00:00`)}
                      {t.accountName ? ` · ${t.accountName}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="tabular-nums">
                      +{formatBRL(t.amount)}
                    </span>
                    <form action={unlinkTransactionFormAction}>
                      <input
                        type="hidden"
                        name="transactionId"
                        value={t.id}
                      />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                        title="Desvincular"
                      >
                        Desvincular
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Histórico de snapshots ({snapshots.length})
          </CardTitle>
          <SnapshotDialog
            investmentId={inv.id}
            trigger={
              <Button size="sm">
                <Plus className="size-3.5" /> Novo snapshot
              </Button>
            }
          />
        </CardHeader>
        <CardContent>
          {snapshots.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum snapshot ainda. Adicione o saldo do mês atual pra começar.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b">
                  <th className="text-left font-normal pb-2">Mês</th>
                  <th className="text-right font-normal pb-2">Aporte</th>
                  <th className="text-right font-normal pb-2">Saldo</th>
                  <th className="text-right font-normal pb-2">Rendimento</th>
                  <th className="w-[40px]" />
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s, i) => {
                  const next = snapshots[i + 1]; // mais antigo, pra calcular
                  const monthReturn = next
                    ? s.balanceCents - next.balanceCents - s.appliedCents
                    : null;
                  return (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-2">
                        <SnapshotDialog
                          investmentId={inv.id}
                          defaultMonth={s.month}
                          defaultApplied={(s.appliedCents / 100).toFixed(2)}
                          defaultBalance={(s.balanceCents / 100).toFixed(2)}
                          defaultNotes={s.notes}
                          trigger={
                            <button
                              type="button"
                              className="hover:underline tabular-nums text-xs"
                            >
                              {s.month}
                            </button>
                          }
                        />
                        {s.notes ? (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {s.notes}
                          </div>
                        ) : null}
                      </td>
                      <td className="text-right tabular-nums text-xs py-2">
                        {s.appliedCents === 0
                          ? "—"
                          : `${s.appliedCents >= 0 ? "+" : "−"}${formatBRL((Math.abs(s.appliedCents) / 100).toFixed(2))}`}
                      </td>
                      <td className="text-right tabular-nums text-xs py-2">
                        {formatBRL((s.balanceCents / 100).toFixed(2))}
                      </td>
                      <td
                        className={`text-right tabular-nums text-xs py-2 ${
                          monthReturn === null
                            ? "text-muted-foreground"
                            : monthReturn >= 0
                              ? "text-emerald-600"
                              : "text-rose-600"
                        }`}
                      >
                        {monthReturn === null
                          ? "—"
                          : `${monthReturn >= 0 ? "+" : "−"}${formatBRL((Math.abs(monthReturn) / 100).toFixed(2))}`}
                      </td>
                      <td className="py-2 text-right">
                        <form action={deleteSnapshotFormAction}>
                          <input type="hidden" name="id" value={s.id} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
