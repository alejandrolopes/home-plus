import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  currentMonthBounds,
  formatBRL,
  monthBoundsISO,
  todayISO,
  todayParts,
} from "@/lib/format";
import { listAccounts } from "@/lib/repos/accounts";
import { listCategories } from "@/lib/repos/categories";
import {
  listTransactions,
  pendingCardSpend,
  summarizeRange,
  totalBalance,
} from "@/lib/repos/transactions";
import { requireOrganization } from "@/lib/guards";
import { getViewMode } from "@/lib/preferences";
import {
  getEffectiveFinanceSettings,
  tithableBaseInRange,
} from "@/lib/repos/finance-settings";
import { TransactionFormDialog } from "../lancamentos/transaction-form";
import { FidelidadeCard } from "./fidelidade-card";

function fidelidadeRanges() {
  const { year, month } = todayParts();
  const cur = monthBoundsISO(year, month);
  const prev =
    month === 1
      ? monthBoundsISO(year - 1, 12)
      : monthBoundsISO(year, month - 1);
  const ytd = { from: `${year}-01-01`, to: todayISO() };
  return { cur, prev, ytd };
}

export default async function DashboardPage() {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  const { from, to } = currentMonthBounds();

  const view = await getViewMode();
  const ranges = fidelidadeRanges();
  const [
    balance,
    summary,
    accounts,
    categories,
    recent,
    pending,
    fidelidade,
    fidCur,
    fidPrev,
    fidYtd,
  ] = await Promise.all([
    totalBalance(orgId, { ownerId: userId }),
    summarizeRange(orgId, { from, to, ownerId: userId }, { view }),
    listAccounts(orgId, { ownerId: userId }),
    listCategories(orgId),
    listTransactions(orgId, { from, to, ownerId: userId }, { view }),
    pendingCardSpend(orgId, { from, to, ownerId: userId }, { view }),
    getEffectiveFinanceSettings(orgId, userId),
    tithableBaseInRange(orgId, { ...ranges.cur, ownerId: userId }),
    tithableBaseInRange(orgId, { ...ranges.prev, ownerId: userId }),
    tithableBaseInRange(orgId, { ...ranges.ytd, ownerId: userId }),
  ]);

  const incomeCents = Math.round(Number(summary.income) * 100);
  const expenseCents = Math.round(Number(summary.expense) * 100);
  const balanceMonth = ((incomeCents - expenseCents) / 100).toFixed(2);
  const hasPending = Number(pending) > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Visão geral das finanças da família.
          </p>
        </div>
        <TransactionFormDialog
          trigger={
            <Button>
              <Plus className="size-4" />
              Novo lançamento
            </Button>
          }
          accounts={accounts.map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
          }))}
          categories={categories.map((c) => ({
            id: c.id,
            name: c.name,
            kind: c.kind,
            color: c.color,
            parentId: c.parentId,
            isTransfer: c.isTransfer,
          }))}
          defaultDate={todayISO()}
          tithingEnabled={fidelidade.tithingEnabled}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col justify-center">
          <CardHeader>
            <CardDescription>Saldo total</CardDescription>
            <CardTitle className="text-5xl tabular-nums">
              {formatBRL(balance)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Soma das contas (exceto cartões).
          </CardContent>
        </Card>

        <div className="grid gap-4 grid-cols-2">
          <Card>
            <CardHeader>
              <CardDescription>Receitas do mês</CardDescription>
              <CardTitle className="text-2xl tabular-nums text-emerald-600">
                {formatBRL(summary.income)}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Despesas do mês</CardDescription>
              <CardTitle className="text-2xl tabular-nums text-rose-600">
                {formatBRL(summary.expense)}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card className="col-span-2">
            <CardHeader>
              <CardDescription>Resultado do mês</CardDescription>
              <CardTitle
                className={`text-3xl tabular-nums ${
                  Number(balanceMonth) >= 0
                    ? "text-emerald-600"
                    : "text-rose-600"
                }`}
              >
                {formatBRL(balanceMonth)}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      </div>

      {fidelidade.tithingEnabled ? (
        <FidelidadeCard
          tithingPct={fidelidade.tithingPct}
          pactOfferingPct={fidelidade.pactOfferingPct}
          current={{ base: fidCur }}
          previous={{ base: fidPrev }}
          ytd={{ base: fidYtd }}
        />
      ) : null}

      {hasPending ? (
        <Card className="border-amber-300 dark:border-amber-700">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardDescription className="text-amber-700 dark:text-amber-500">
                Despesas pendentes do cartão
              </CardDescription>
              <CardTitle className="text-3xl tabular-nums text-amber-600">
                {formatBRL(pending)}
              </CardTitle>
            </div>
            <Button variant="outline" render={<Link href="/cartoes" />} size="sm" nativeButton={false}>
              Ver cartões
            </Button>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Compras feitas no cartão que ainda não foram quitadas. Já contam no
            "Despesas do mês".
          </CardContent>
        </Card>
      ) : null}

      {accounts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Comece por aqui</CardTitle>
            <CardDescription>
              Cadastre suas contas para começar a registrar lançamentos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/contas" />} nativeButton={false}>
              Cadastrar contas
            </Button>
          </CardContent>
        </Card>
      ) : recent.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nenhum lançamento este mês</CardTitle>
            <CardDescription>
              Use o botão "Novo lançamento" no topo para começar.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Últimos lançamentos</CardTitle>
            <CardDescription>
              {recent.length} no mês corrente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {recent.slice(0, 8).map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between py-2"
                >
                  <div>
                    <div
                      className="text-sm font-medium"
                      title={t.description}
                    >
                      {t.cleanDescription ?? t.description}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t.account?.name ?? "Sem conta"}
                      {t.category ? ` · ${t.category.name}` : ""}
                    </div>
                  </div>
                  <div
                    className={`tabular-nums text-sm font-medium ${
                      t.kind === "income"
                        ? "text-emerald-600"
                        : "text-rose-600"
                    }`}
                  >
                    {t.kind === "income" ? "+" : "−"}
                    {formatBRL(t.amount)}
                  </div>
                </li>
              ))}
            </ul>
            {recent.length > 8 ? (
              <div className="pt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  render={<Link href="/lancamentos" />}
                  nativeButton={false}
                >
                  Ver todos
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
