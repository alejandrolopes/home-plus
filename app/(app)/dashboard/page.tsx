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
import { creditCardUsage, listAccounts } from "@/lib/repos/accounts";
import {
  budgetsForMonth,
  categoriesForBudget,
  spendingByMonth,
} from "@/lib/repos/budgets";
import { listCategories } from "@/lib/repos/categories";
import {
  computeTotals,
  listInvestments,
  totalAppliedInMonth,
} from "@/lib/repos/investments";
import { listVisiblePlans } from "@/lib/repos/plans";
import {
  listTransactions,
  monthlyIncomeExpenseHistory,
  pendingCardSpend,
  summarizeRange,
  totalBalance,
} from "@/lib/repos/transactions";
import { requireOrganization } from "@/lib/guards";
import { getEnabledModules } from "@/lib/modules";
import { getViewMode } from "@/lib/preferences";
import {
  getEffectiveFinanceSettings,
  tithableBaseInRange,
} from "@/lib/repos/finance-settings";
import { TransactionFormDialog } from "../lancamentos/transaction-form";
import { FidelidadeCard } from "./fidelidade-card";
import { IncomeExpenseChart } from "./income-expense-chart";

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
  const modules = await getEnabledModules(orgId);
  const showCartoes = modules.has("cartoes");
  const showFidelidade = modules.has("fidelidade");
  const showOrcamento = modules.has("orcamento");
  const showPlanos = modules.has("planos");
  const showInvestimentos = modules.has("investimentos");
  const currentMonthKey = `${from.slice(0, 7)}`;
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
    history,
    cardUsage,
  ] = await Promise.all([
    totalBalance(orgId, { ownerId: userId }),
    summarizeRange(orgId, { from, to, ownerId: userId }, { view }),
    listAccounts(orgId, { ownerId: userId }),
    listCategories(orgId),
    listTransactions(orgId, { from, to, ownerId: userId }, { view }),
    showCartoes
      ? pendingCardSpend(orgId, { from, to, ownerId: userId }, { view })
      : Promise.resolve("0"),
    getEffectiveFinanceSettings(orgId, userId),
    showFidelidade
      ? tithableBaseInRange(orgId, { ...ranges.cur, ownerId: userId })
      : Promise.resolve("0"),
    showFidelidade
      ? tithableBaseInRange(orgId, { ...ranges.prev, ownerId: userId })
      : Promise.resolve("0"),
    showFidelidade
      ? tithableBaseInRange(orgId, { ...ranges.ytd, ownerId: userId })
      : Promise.resolve("0"),
    monthlyIncomeExpenseHistory(orgId, { ownerId: userId, monthsBack: 12 }),
    showCartoes
      ? creditCardUsage(orgId, { ownerId: userId })
      : Promise.resolve([] as Awaited<ReturnType<typeof creditCardUsage>>),
  ]);

  const plans = showPlanos
    ? await listVisiblePlans(orgId, userId)
    : [];
  // Top 4 planos por proximidade do prazo (já vem ordenado por endDate asc)
  const topPlans = plans.slice(0, 4);

  const investmentsForDashboard = showInvestimentos
    ? await listInvestments(orgId, userId)
    : [];
  const investmentTotals = computeTotals(investmentsForDashboard);
  const investmentAppliedThisMonth = showInvestimentos
    ? await totalAppliedInMonth(orgId, userId, currentMonthKey)
    : 0;

  // Orçamento: realizado vs planejado por categoria (top 6 com planejado > 0)
  let budgetSummary: Array<{
    categoryId: string;
    name: string;
    color: string | null;
    planned: number;
    spent: number;
    pct: number;
  }> = [];
  let budgetTotalPlanned = 0;
  let budgetTotalSpent = 0;
  if (showOrcamento) {
    const [allCats, budgets, spending] = await Promise.all([
      categoriesForBudget(orgId),
      budgetsForMonth(orgId, currentMonthKey),
      spendingByMonth(orgId, currentMonthKey, { ownerId: userId }),
    ]);
    const catById = new Map(allCats.map((c) => [c.id, c]));
    const rolledSpent = new Map<string, number>();
    const rolledPlanned = new Map<string, number>();
    // Rolha mãe = ela própria; rolha filho = mãe
    const rootOf = (id: string): string => {
      const cat = catById.get(id);
      return cat?.parentId ? rootOf(cat.parentId) : id;
    };
    for (const [catId, amt] of spending) {
      const root = rootOf(catId);
      rolledSpent.set(root, (rolledSpent.get(root) ?? 0) + Number(amt));
    }
    for (const [catId, b] of budgets) {
      const root = rootOf(catId);
      rolledPlanned.set(root, (rolledPlanned.get(root) ?? 0) + Number(b.amount));
    }
    for (const cat of allCats) {
      if (cat.parentId) continue;
      if (cat.kind !== "expense") continue;
      if (cat.archived || !cat.includeInReports) continue;
      const planned = rolledPlanned.get(cat.id) ?? 0;
      const spent = rolledSpent.get(cat.id) ?? 0;
      if (planned === 0 && spent === 0) continue;
      budgetTotalPlanned += planned;
      budgetTotalSpent += spent;
      budgetSummary.push({
        categoryId: cat.id,
        name: cat.name,
        color: cat.color,
        planned,
        spent,
        pct: planned > 0 ? spent / planned : 0,
      });
    }
    budgetSummary.sort((a, b) => b.spent - a.spent);
    budgetSummary = budgetSummary.slice(0, 6);
  }

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

      <Card>
        <CardHeader>
          <CardDescription>Receitas vs Despesas — últimos 12 meses</CardDescription>
        </CardHeader>
        <CardContent>
          <IncomeExpenseChart points={history} />
        </CardContent>
      </Card>

      {showInvestimentos && investmentsForDashboard.length > 0 ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardDescription>Investimentos</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {formatBRL((investmentTotals.totalBalanceCents / 100).toFixed(2))}
              </CardTitle>
              <CardDescription className="text-xs space-y-0.5">
                <div>
                  Rendimento total{" "}
                  <span
                    className={
                      investmentTotals.lifetimeReturnCents >= 0
                        ? "text-emerald-600"
                        : "text-rose-600"
                    }
                  >
                    {investmentTotals.lifetimeReturnCents >= 0 ? "+" : "−"}
                    {formatBRL(
                      (Math.abs(investmentTotals.lifetimeReturnCents) / 100).toFixed(2),
                    )}
                  </span>
                  {" · "}último mês{" "}
                  <span
                    className={
                      investmentTotals.lastMonthReturnCents >= 0
                        ? "text-emerald-600"
                        : "text-rose-600"
                    }
                  >
                    {investmentTotals.lastMonthReturnCents >= 0 ? "+" : "−"}
                    {formatBRL(
                      (Math.abs(investmentTotals.lastMonthReturnCents) / 100).toFixed(2),
                    )}
                  </span>
                </div>
                {investmentAppliedThisMonth !== 0 ? (
                  <div>
                    Aportado este mês{" "}
                    <span
                      className={
                        investmentAppliedThisMonth >= 0
                          ? "text-sky-600"
                          : "text-amber-600"
                      }
                    >
                      {investmentAppliedThisMonth >= 0 ? "+" : "−"}
                      {formatBRL(
                        (Math.abs(investmentAppliedThisMonth) / 100).toFixed(2),
                      )}
                    </span>
                  </div>
                ) : null}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              render={<Link href="/investimentos" />}
              size="sm"
              nativeButton={false}
            >
              Ver carteira
            </Button>
          </CardHeader>
        </Card>
      ) : null}

      {showPlanos && topPlans.length > 0 ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardDescription>Planos e metas</CardDescription>
            <Button
              variant="outline"
              render={<Link href="/planos" />}
              size="sm"
              nativeButton={false}
            >
              Ver todos
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {topPlans.map((p) => {
              const color = p.color ?? "#0ea5e9";
              const pctR = Math.min(1, p.progress);
              return (
                <Link
                  key={p.id}
                  href={`/planos/${p.id}`}
                  className="block space-y-1 rounded-md hover:bg-muted/40 p-1 -m-1 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        aria-hidden
                        className="inline-block size-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="font-medium truncate">{p.name}</span>
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                      {formatBRL((p.currentCents / 100).toFixed(2))}
                      {" / "}
                      {formatBRL((p.targetCents / 100).toFixed(2))}{" "}
                      <span className="font-medium text-foreground">
                        ({Math.round(p.progress * 100)}%)
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${pctR * 100}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {showOrcamento && budgetSummary.length > 0 ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardDescription>Realizado vs Planejado</CardDescription>
              <CardTitle className="text-lg tabular-nums">
                {formatBRL(budgetTotalSpent.toFixed(2))}
                <span className="text-sm text-muted-foreground font-normal">
                  {" / "}
                  {formatBRL(budgetTotalPlanned.toFixed(2))}
                </span>
              </CardTitle>
            </div>
            <Button
              variant="outline"
              render={<Link href="/orcamento" />}
              size="sm"
              nativeButton={false}
            >
              Ver orçamento
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {budgetSummary.map((b) => {
              const pctR = Math.min(1, b.pct);
              const over = b.pct > 1 ? Math.round((b.pct - 1) * 100) : 0;
              const color =
                b.pct === 0
                  ? "bg-muted"
                  : b.pct < 0.7
                    ? "bg-emerald-500"
                    : b.pct < 1
                      ? "bg-amber-500"
                      : "bg-rose-500";
              return (
                <div key={b.categoryId} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      {b.color ? (
                        <span
                          aria-hidden
                          className="inline-block size-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: b.color }}
                        />
                      ) : null}
                      <span className="font-medium truncate">{b.name}</span>
                      {over > 0 ? (
                        <span className="text-[10px] text-rose-700 dark:text-rose-400">
                          +{over}%
                        </span>
                      ) : null}
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                      {formatBRL(b.spent.toFixed(2))}
                      {b.planned > 0 ? (
                        <>
                          {" / "}
                          {formatBRL(b.planned.toFixed(2))}{" "}
                          <span className="font-medium text-foreground">
                            ({Math.round(b.pct * 100)}%)
                          </span>
                        </>
                      ) : null}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full ${color} transition-all`}
                      style={{ width: `${pctR * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {showCartoes && cardUsage.length > 0 ? (
        <Card>
          <CardHeader>
            <CardDescription>Uso do limite dos cartões</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {cardUsage.map((c) => {
              const pct = Math.round(c.usagePct * 100);
              const barColor =
                pct >= 90
                  ? "bg-rose-500"
                  : pct >= 70
                    ? "bg-amber-500"
                    : "bg-emerald-500";
              return (
                <div key={c.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      {c.color ? (
                        <span
                          aria-hidden
                          className="inline-block size-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: c.color }}
                        />
                      ) : null}
                      <span className="font-medium truncate">{c.name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      {formatBRL(c.debt)} / {formatBRL(c.creditLimit)}{" "}
                      <span className="font-medium text-foreground">({pct}%)</span>
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full ${barColor} transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {showFidelidade && fidelidade.tithingEnabled ? (
        <FidelidadeCard
          tithingPct={fidelidade.tithingPct}
          pactOfferingPct={fidelidade.pactOfferingPct}
          current={{ base: fidCur }}
          previous={{ base: fidPrev }}
          ytd={{ base: fidYtd }}
        />
      ) : null}

      {showCartoes && hasPending ? (
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
