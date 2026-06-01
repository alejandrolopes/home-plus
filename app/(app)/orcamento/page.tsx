import { notFound } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { currentMonthISO, formatBRL } from "@/lib/format";
import { requireOrganization } from "@/lib/guards";
import { isModuleEnabled } from "@/lib/modules";
import {
  budgetsForMonth,
  categoriesForBudget,
  spendingByMonth,
  spendingStatsByCategory,
} from "@/lib/repos/budgets";
import { MonthPicker } from "../relatorios/month-picker";
import { BudgetRow, type BudgetRowData } from "./budget-row";

function isValidMonth(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
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

export default async function OrcamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; mode?: string }>;
}) {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  if (!(await isModuleEnabled(orgId, "orcamento"))) notFound();

  const params = await searchParams;
  const month =
    params.month && isValidMonth(params.month)
      ? params.month
      : currentMonthISO();
  // mode "default" edita o padrão; "month" mostra realizado e edita override
  const mode: "default" | "month" =
    params.mode === "default" ? "default" : "month";

  const [categories, budgets, spending, stats] = await Promise.all([
    categoriesForBudget(orgId),
    budgetsForMonth(orgId, month),
    spendingByMonth(orgId, month, { ownerId: userId }),
    spendingStatsByCategory(orgId, { monthsBack: 6, ownerId: userId }),
  ]);

  // Filtra: só expense, não arquivada, includeInReports
  const visibleCategories = categories.filter(
    (c) => c.kind === "expense" && !c.archived && c.includeInReports,
  );
  // Constrói pares (mãe, filhos)
  const roots = visibleCategories.filter((c) => !c.parentId);
  const childrenByParent = new Map<string, typeof visibleCategories>();
  for (const c of visibleCategories) {
    if (!c.parentId) continue;
    const arr = childrenByParent.get(c.parentId) ?? [];
    arr.push(c);
    childrenByParent.set(c.parentId, arr);
  }

  // Totais
  let totalPlanned = 0;
  let totalSpent = 0;
  for (const [, b] of budgets) totalPlanned += Number(b.amount);
  for (const [, s] of spending) totalSpent += Number(s);
  const pct = totalPlanned > 0 ? totalSpent / totalPlanned : 0;

  const statFor = (id: string) => {
    const s = stats.get(id);
    if (!s) return null;
    return {
      avg: (s.avgCents / 100).toFixed(2),
      min: (s.minCents / 100).toFixed(2),
      max: (s.maxCents / 100).toFixed(2),
      samples: s.samples,
    };
  };

  // Lista linear na ordem mãe → filhos
  const rows: BudgetRowData[] = [];
  for (const root of roots.sort((a, b) => a.name.localeCompare(b.name))) {
    rows.push({
      categoryId: root.id,
      categoryName: root.name,
      categoryColor: root.color,
      displayName: root.name,
      isSub: false,
      scope: mode,
      monthKey: mode === "month" ? month : null,
      initialAmount: budgets.get(root.id)?.amount ?? "0",
      spentAmount: spending.get(root.id) ?? "0",
      suggestion: statFor(root.id),
    });
    const kids = (childrenByParent.get(root.id) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const c of kids) {
      rows.push({
        categoryId: c.id,
        categoryName: c.name,
        categoryColor: c.color ?? root.color,
        displayName: c.name,
        isSub: true,
        scope: mode,
        monthKey: mode === "month" ? month : null,
        initialAmount: budgets.get(c.id)?.amount ?? "0",
        spentAmount: spending.get(c.id) ?? "0",
        suggestion: statFor(c.id),
      });
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Orçamento</h1>
          <p className="text-muted-foreground">
            Quanto você planeja gastar em cada categoria, mês a mês.
          </p>
        </div>
        <MonthPicker month={month} />
      </div>

      <div className="inline-flex items-center rounded-md border bg-background p-0.5 text-xs">
        {(
          [
            { v: "month", label: `Planejado para ${formatMonthLabel(month)}` },
            { v: "default", label: "Padrão (todos os meses)" },
          ] as const
        ).map((opt) => (
          <a
            key={opt.v}
            href={`/orcamento?${new URLSearchParams({
              month,
              ...(opt.v === "default" ? { mode: "default" } : {}),
            }).toString()}`}
            className={`px-3 py-1.5 rounded transition-colors ${
              mode === opt.v
                ? "bg-secondary text-secondary-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.label}
          </a>
        ))}
      </div>

      {mode === "month" ? (
        <div className="grid gap-3 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardDescription>Planejado</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {formatBRL(totalPlanned.toFixed(2))}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Realizado</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {formatBRL(totalSpent.toFixed(2))}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>% do orçamento usado</CardDescription>
              <CardTitle
                className={`text-2xl tabular-nums ${
                  pct >= 1
                    ? "text-rose-600"
                    : pct >= 0.7
                      ? "text-amber-600"
                      : "text-emerald-600"
                }`}
              >
                {totalPlanned > 0 ? `${Math.round(pct * 100)}%` : "—"}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {mode === "month"
              ? `Categorias — ${formatMonthLabel(month)}`
              : "Orçamento padrão por categoria"}
          </CardTitle>
          <CardDescription>
            {mode === "month"
              ? "Define o valor planejado pra este mês (sobrescreve o padrão). Clica no valor pra editar."
              : "Valor aplicado a todos os meses que não tiverem ajuste específico."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma categoria de despesa cadastrada.
            </p>
          ) : (
            <div className="divide-y">
              {rows.map((r) => (
                <BudgetRow key={`${r.scope}-${r.categoryId}`} row={r} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
