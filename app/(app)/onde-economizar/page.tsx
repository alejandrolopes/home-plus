import Link from "next/link";
import { AlertTriangle, TrendingDown, Wallet } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatBRL } from "@/lib/format";
import { requireOrganization } from "@/lib/guards";
import { listCategories } from "@/lib/repos/categories";
import {
  getMonthlyHistoryByRole,
  getSpendingByRole,
  getTotalExpenses,
} from "@/lib/repos/spending-analysis";
import { MonthPicker } from "../relatorios/month-picker";
import { autoClassifyIfFirstAccess } from "./actions";
import { CategoryLineChart } from "./category-line-chart";
import { ConfigDialog } from "./config-dialog";
import { EssenciaisWindowToggle } from "./essenciais-window-toggle";

function currentMonthISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function isValidMonth(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

function monthBounds(month: string) {
  const [yStr, mStr] = month.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: fmt(first), to: fmt(last) };
}

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  const label = d.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default async function OndeEconomizarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; tab?: string; window?: string }>;
}) {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  const params = await searchParams;

  // Primeiro acesso: auto-classifica categorias por nome se NENHUMA tem role.
  await autoClassifyIfFirstAccess();

  const month =
    params.month && isValidMonth(params.month)
      ? params.month
      : currentMonthISO();
  const tab: "opcionais" | "essenciais" =
    params.tab === "essenciais" ? "essenciais" : "opcionais";
  const windowMode: "fixed" | "rolling" =
    params.window === "fixed" ? "fixed" : "rolling";

  const { from, to } = monthBounds(month);

  // Dados pros dois sections (uma query cada lado é leve)
  const [
    luxuryCurrent,
    luxuryPrev,
    totalExpensesCurrent,
    categories,
    essentialHistory,
  ] = await Promise.all([
    getSpendingByRole(orgId, userId, from, to, "luxury"),
    (async () => {
      const { from: pf, to: pt } = monthBounds(prevMonth(month));
      return getSpendingByRole(orgId, userId, pf, pt, "luxury");
    })(),
    getTotalExpenses(orgId, userId, from, to),
    listCategories(orgId),
    (async () => {
      // Janela de 12 meses. Em rolling, termina no mês selecionado.
      const endMonth = windowMode === "fixed" ? currentMonthISO() : month;
      const startMonth = shiftMonth(endMonth, -11);
      return getMonthlyHistoryByRole(
        orgId,
        userId,
        "essential",
        startMonth,
        endMonth,
      );
    })(),
  ]);

  const luxuryTotal = luxuryCurrent.reduce((s, r) => s + r.total, 0);
  const luxuryPrevTotal = luxuryPrev.reduce((s, r) => s + r.total, 0);
  const luxuryPercent =
    totalExpensesCurrent > 0
      ? (luxuryTotal / totalExpensesCurrent) * 100
      : 0;
  const luxuryDelta =
    luxuryPrevTotal > 0
      ? ((luxuryTotal - luxuryPrevTotal) / luxuryPrevTotal) * 100
      : null;
  const save20 = luxuryTotal * 0.2;
  const save30 = luxuryTotal * 0.3;

  // Categorias expense pra config dialog
  const expenseCategories = categories
    .filter((c) => c.kind === "expense" && !c.isTransfer)
    .map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      role: (c.role ?? null) as "luxury" | "essential" | null,
    }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Onde economizar
          </h1>
          <p className="text-muted-foreground">
            Análise de gastos com potencial de redução e otimização.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MonthPicker month={month} />
          <ConfigDialog categories={expenseCategories} />
        </div>
      </div>

      <div className="flex gap-2 border-b">
        <Link
          href={{
            pathname: "/onde-economizar",
            query: { ...params, tab: "opcionais" },
          }}
          className={`px-3 py-2 text-sm border-b-2 ${tab === "opcionais" ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Opcionais
        </Link>
        <Link
          href={{
            pathname: "/onde-economizar",
            query: { ...params, tab: "essenciais" },
          }}
          className={`px-3 py-2 text-sm border-b-2 ${tab === "essenciais" ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Essenciais
        </Link>
      </div>

      {tab === "opcionais" ? (
        <OpcionaisSection
          monthLabel={formatMonthLabel(month).toLowerCase()}
          total={luxuryTotal}
          percent={luxuryPercent}
          delta={luxuryDelta}
          prevTotal={luxuryPrevTotal}
          save20={save20}
          save30={save30}
          rows={luxuryCurrent}
          from={from}
          to={to}
        />
      ) : (
        <EssenciaisSection
          windowMode={windowMode}
          history={essentialHistory}
        />
      )}
    </div>
  );
}

function OpcionaisSection({
  monthLabel,
  total,
  percent,
  delta,
  prevTotal,
  save20,
  save30,
  rows,
  from,
  to,
}: {
  monthLabel: string;
  total: number;
  percent: number;
  delta: number | null;
  prevTotal: number;
  save20: number;
  save30: number;
  rows: Array<{
    categoryId: string;
    categoryName: string;
    categoryColor: string | null;
    total: number;
  }>;
  from: string;
  to: string;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Gastos opcionais em {monthLabel}</CardDescription>
            <CardTitle className="text-2xl tabular-nums text-amber-600">
              {formatBRL(total.toFixed(2))}
            </CardTitle>
            <CardDescription className="text-xs">
              {rows.length} categoria(s)
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>% das despesas totais</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {percent.toFixed(1)}%
            </CardTitle>
            <CardDescription className="text-xs">
              {delta !== null ? (
                <span
                  className={
                    delta > 0
                      ? "text-rose-600"
                      : delta < 0
                        ? "text-emerald-600"
                        : ""
                  }
                >
                  {delta > 0 ? "↑" : delta < 0 ? "↓" : "·"}{" "}
                  {Math.abs(delta).toFixed(1)}% vs mês anterior (
                  {formatBRL(prevTotal.toFixed(2))})
                </span>
              ) : (
                "sem dados do mês anterior"
              )}
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Meta de economia</CardDescription>
            <CardTitle className="text-2xl tabular-nums text-emerald-600">
              {formatBRL(save20.toFixed(2))}
            </CardTitle>
            <CardDescription className="text-xs">
              cortando 20% · ou {formatBRL(save30.toFixed(2))} cortando 30%
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardDescription>
              Nenhuma categoria classificada como opcional tem lançamentos
              neste mês. Clique em "Configurar categorias" pra ajustar a
              classificação.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingDown className="size-4 text-amber-600" />
              Ranking — onde mais consumiu o orçamento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {rows.map((r) => {
                const pctOfLuxury =
                  total > 0 ? (r.total / total) * 100 : 0;
                return (
                  <li key={r.categoryId} className="space-y-1">
                    <Link
                      href={`/lancamentos?category=${r.categoryId}&from=${from}&to=${to}`}
                      className="flex items-center justify-between text-sm rounded px-1 -mx-1 py-0.5 hover:bg-muted/40"
                      title={`Ver lançamentos de ${r.categoryName} no mês`}
                    >
                      <span className="inline-flex items-center gap-2 min-w-0">
                        {r.categoryColor ? (
                          <span
                            aria-hidden
                            className="inline-block size-2.5 rounded-full shrink-0"
                            style={{ background: r.categoryColor }}
                          />
                        ) : null}
                        <span className="truncate">{r.categoryName}</span>
                      </span>
                      <span className="tabular-nums font-medium">
                        {formatBRL(r.total.toFixed(2))}
                        <span className="text-muted-foreground ml-2 text-xs">
                          {pctOfLuxury.toFixed(1)}%
                        </span>
                      </span>
                    </Link>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-amber-500"
                        style={{ width: `${pctOfLuxury}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {total > 0 ? (
        <Card className="border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="size-4 text-emerald-600" />
              Sugestão
            </CardTitle>
            <CardDescription>
              Se você reduzir os gastos opcionais em <strong>20%</strong> no próximo
              mês, sobram{" "}
              <strong className="text-emerald-700 dark:text-emerald-400">
                {formatBRL(save20.toFixed(2))}
              </strong>{" "}
              — em 12 meses, {formatBRL((save20 * 12).toFixed(2))}. Comece
              olhando o topo do ranking acima.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </div>
  );
}

function EssenciaisSection({
  windowMode,
  history,
}: {
  windowMode: "fixed" | "rolling";
  history: Array<{
    categoryId: string;
    categoryName: string;
    categoryColor: string | null;
    points: Array<{ month: string; total: number }>;
  }>;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm text-muted-foreground">
          Histórico de 12 meses por categoria essencial. Alerta quando o mês
          mais recente está mais de 20% acima da média.
        </div>
        <EssenciaisWindowToggle value={windowMode} />
      </div>

      {history.length === 0 ? (
        <Card>
          <CardHeader>
            <CardDescription>
              Nenhuma categoria classificada como essencial. Clique em
              "Configurar categorias" pra marcar (ex.: Luz, Água, Internet).
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {history.map((h) => {
            const last = h.points[h.points.length - 1]?.total ?? 0;
            const nonZeroPoints = h.points.filter((p) => p.total > 0);
            const avg =
              nonZeroPoints.length > 0
                ? nonZeroPoints.reduce((s, p) => s + p.total, 0) /
                  nonZeroPoints.length
                : 0;
            const deltaPct =
              avg > 0 ? ((last - avg) / avg) * 100 : null;
            const isPeak = deltaPct !== null && deltaPct > 20;

            return (
              <Card
                key={h.categoryId}
                className={isPeak ? "border-rose-300" : undefined}
              >
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="inline-flex items-center gap-2 min-w-0">
                      {h.categoryColor ? (
                        <span
                          aria-hidden
                          className="inline-block size-2.5 rounded-full shrink-0"
                          style={{ background: h.categoryColor }}
                        />
                      ) : null}
                      <span className="truncate">{h.categoryName}</span>
                    </span>
                    {isPeak ? (
                      <AlertTriangle className="size-4 text-rose-600 shrink-0" />
                    ) : null}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    <span className="inline-flex items-center gap-3">
                      <span>
                        Último: <strong>{formatBRL(last.toFixed(2))}</strong>
                      </span>
                      <span>
                        Média: {formatBRL(avg.toFixed(2))}
                      </span>
                      {deltaPct !== null ? (
                        <span
                          className={
                            deltaPct > 20
                              ? "text-rose-600 font-medium"
                              : deltaPct > 0
                                ? "text-amber-600"
                                : "text-emerald-600"
                          }
                        >
                          {deltaPct > 0 ? "↑" : "↓"}{" "}
                          {Math.abs(deltaPct).toFixed(1)}%
                        </span>
                      ) : null}
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <CategoryLineChart
                    points={h.points}
                    color={h.categoryColor}
                    avg={avg}
                  />
                  {isPeak ? (
                    <p className="mt-2 text-xs text-rose-700 dark:text-rose-400">
                      Conta subiu <strong>{deltaPct!.toFixed(0)}%</strong> em
                      relação à média. Vale revisar o consumo ou negociar a
                      tarifa.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
