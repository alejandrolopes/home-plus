import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, TrendingUp, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatBRL } from "@/lib/format";
import { requireOrganization } from "@/lib/guards";
import { isModuleEnabled } from "@/lib/modules";
import { fetchBcbIndicators } from "@/lib/repos/bcb";
import {
  computeFinancialIndependence,
  computeTotals,
  listInvestments,
  portfolioHistory,
} from "@/lib/repos/investments";
import { cn } from "@/lib/utils";
import { FIGauge } from "./fi-gauge";
import { InstitutionDonut } from "./institution-donut";
import { InvestmentFormDialog } from "./investment-form";
import { PortfolioChart } from "./portfolio-chart";
import { SnapshotDialog } from "./snapshot-dialog";

const CLASS_LABEL: Record<string, string> = {
  fixed_income: "Renda fixa",
  variable_income: "Renda variável",
};

export default async function InvestimentosPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  if (!(await isModuleEnabled(orgId, "investimentos"))) notFound();

  const params = await searchParams;
  const includeArchived = params.view === "archived";
  const investments = await listInvestments(orgId, userId, { includeArchived });
  const visible = investments.filter((i) =>
    includeArchived ? i.archived : !i.archived,
  );
  const totals = computeTotals(visible);
  const [fi, bcb, history] = await Promise.all([
    computeFinancialIndependence(orgId, userId, { monthsBack: 6 }),
    fetchBcbIndicators(),
    portfolioHistory(orgId, userId, { monthsBack: 12 }),
  ]);

  const fixedPct =
    totals.totalBalanceCents > 0
      ? (totals.byClass.fixed_income / totals.totalBalanceCents) * 100
      : 0;
  const variablePct =
    totals.totalBalanceCents > 0
      ? (totals.byClass.variable_income / totals.totalBalanceCents) * 100
      : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Investimentos</h1>
          <p className="text-muted-foreground">
            Cadastre seus produtos e atualize o saldo mês a mês para acompanhar
            rendimento.
          </p>
        </div>
        <InvestmentFormDialog
          trigger={
            <Button>
              <Plus className="size-4" />
              Novo investimento
            </Button>
          }
        />
      </div>

      <div className="inline-flex items-center rounded-md border bg-background p-0.5 text-sm">
        <Link
          href="/investimentos"
          className={cn(
            "rounded px-3 py-1 transition-colors",
            !includeArchived
              ? "bg-secondary text-secondary-foreground font-medium"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Ativos
        </Link>
        <Link
          href="/investimentos?view=archived"
          className={cn(
            "rounded px-3 py-1 transition-colors",
            includeArchived
              ? "bg-secondary text-secondary-foreground font-medium"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Arquivados
        </Link>
      </div>

      {visible.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-4">
          <Card>
            <CardHeader>
              <CardDescription>Saldo total</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {formatBRL((totals.totalBalanceCents / 100).toFixed(2))}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Total aplicado</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {formatBRL((totals.totalAppliedCents / 100).toFixed(2))}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Rendimento total</CardDescription>
              <CardTitle
                className={`text-2xl tabular-nums ${totals.lifetimeReturnCents >= 0 ? "text-emerald-600" : "text-rose-600"}`}
              >
                {totals.lifetimeReturnCents >= 0 ? "+" : "−"}
                {formatBRL(
                  (Math.abs(totals.lifetimeReturnCents) / 100).toFixed(2),
                )}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Rendimento do mês</CardDescription>
              <CardTitle
                className={`text-2xl tabular-nums ${totals.lastMonthReturnCents >= 0 ? "text-emerald-600" : "text-rose-600"}`}
              >
                {totals.lastMonthReturnCents >= 0 ? "+" : "−"}
                {formatBRL(
                  (Math.abs(totals.lastMonthReturnCents) / 100).toFixed(2),
                )}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      ) : null}

      {bcb.selic || bcb.cdi || bcb.ipca12m ? (
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Indicadores do Banco Central</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-3 gap-3 text-sm">
              {[
                { key: "selic", label: "SELIC", suffix: "% a.a.", data: bcb.selic },
                { key: "cdi", label: "CDI", suffix: "% a.a.", data: bcb.cdi },
                { key: "ipca12m", label: "IPCA 12m", suffix: "%", data: bcb.ipca12m },
              ].map((ind) => (
                <div key={ind.key} className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">{ind.label}</div>
                  {ind.data ? (
                    <>
                      <div className="text-lg tabular-nums font-medium">
                        {ind.data.value.toFixed(2)}
                        <span className="text-xs text-muted-foreground ml-1">
                          {ind.suffix}
                        </span>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {ind.data.date}
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground">—</div>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              Fonte: BCB · cache de 6 horas
            </p>
          </CardContent>
        </Card>
      ) : null}

      {visible.length > 0 && fi.samplesReturn > 0 && fi.samplesExpense > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Grau de Independência Financeira
            </CardTitle>
            <CardDescription>
              Quanto do seu gasto típico mensal já é coberto pelo rendimento
              dos investimentos (média 6 meses).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FIGauge
              ratio={fi.ratio}
              avgReturnCents={fi.avgMonthlyReturnCents}
              avgExpenseCents={fi.avgMonthlyExpenseCents}
              samplesReturn={fi.samplesReturn}
              samplesExpense={fi.samplesExpense}
            />
          </CardContent>
        </Card>
      ) : null}

      {history.length > 1 ? (
        <Card>
          <CardHeader>
            <CardDescription>Evolução do saldo — últimos 12 meses</CardDescription>
          </CardHeader>
          <CardContent>
            <PortfolioChart points={history} />
          </CardContent>
        </Card>
      ) : null}

      {visible.length > 0 && totals.totalBalanceCents > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardDescription>Renda fixa vs Variável</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>Renda fixa</span>
                  <span className="tabular-nums">
                    {formatBRL((totals.byClass.fixed_income / 100).toFixed(2))}{" "}
                    ({fixedPct.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-emerald-500"
                    style={{ width: `${fixedPct}%` }}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>Renda variável</span>
                  <span className="tabular-nums">
                    {formatBRL((totals.byClass.variable_income / 100).toFixed(2))}{" "}
                    ({variablePct.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-sky-500"
                    style={{ width: `${variablePct}%` }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Por instituição</CardDescription>
            </CardHeader>
            <CardContent>
              <InstitutionDonut
                data={Array.from(totals.byInstitution.entries()).map(
                  ([label, cents]) => ({ label, cents }),
                )}
              />
            </CardContent>
          </Card>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">
            {includeArchived
              ? "Nenhum investimento arquivado."
              : "Nenhum investimento ainda. Comece cadastrando um produto."}
          </p>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Seus investimentos</CardTitle>
            <CardDescription>
              Clique no nome para ver o histórico completo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {visible.map((inv) => {
                const monthly = inv.lastMonthReturnCents;
                const pctReturn =
                  inv.totalAppliedCents > 0
                    ? ((inv.currentBalanceCents - inv.totalAppliedCents) /
                        inv.totalAppliedCents) *
                      100
                    : 0;
                return (
                  <div
                    key={inv.id}
                    className="flex flex-wrap items-center gap-3 py-3"
                  >
                    {inv.color ? (
                      <span
                        aria-hidden
                        className="inline-block size-2.5 rounded-full"
                        style={{ backgroundColor: inv.color }}
                      />
                    ) : null}
                    <div className="flex-1 min-w-[200px]">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/investimentos/${inv.id}`}
                          className="font-medium text-sm hover:underline"
                        >
                          {inv.productName}
                        </Link>
                        {inv.ownerId === null ? (
                          <Users
                            className="size-3 text-muted-foreground"
                            aria-label="Investimento da família"
                          />
                        ) : null}
                        <Badge variant="outline" className="text-[10px]">
                          {CLASS_LABEL[inv.class] ?? inv.class}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {inv.institution}
                        {inv.issuer ? ` · ${inv.issuer}` : ""}
                      </div>
                    </div>
                    <div className="w-[120px] text-right text-xs">
                      <div className="text-muted-foreground">Aplicado</div>
                      <div className="tabular-nums font-medium">
                        {formatBRL((inv.totalAppliedCents / 100).toFixed(2))}
                      </div>
                    </div>
                    <div className="w-[120px] text-right text-xs">
                      <div className="text-muted-foreground">Saldo</div>
                      <div className="tabular-nums font-medium">
                        {formatBRL((inv.currentBalanceCents / 100).toFixed(2))}
                      </div>
                    </div>
                    <div className="w-[120px] text-right text-xs">
                      <div className="text-muted-foreground">Rendimento</div>
                      <div
                        className={`tabular-nums font-medium ${pctReturn >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                      >
                        {pctReturn >= 0 ? "+" : ""}
                        {pctReturn.toFixed(2)}%
                      </div>
                    </div>
                    <div className="w-[100px] text-right text-xs">
                      <div className="text-muted-foreground">Último mês</div>
                      <div
                        className={`tabular-nums font-medium ${
                          monthly === null
                            ? "text-muted-foreground"
                            : monthly >= 0
                              ? "text-emerald-600"
                              : "text-rose-600"
                        }`}
                      >
                        {monthly === null
                          ? "—"
                          : `${monthly >= 0 ? "+" : "−"}${formatBRL((Math.abs(monthly) / 100).toFixed(2))}`}
                      </div>
                    </div>
                    <SnapshotDialog
                      investmentId={inv.id}
                      trigger={
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                        >
                          <TrendingUp className="size-3" />
                          Atualizar
                        </Button>
                      }
                    />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
