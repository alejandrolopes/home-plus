import { TrendingDown, TrendingUp } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatBRL } from "@/lib/format";
import { requireOrganization } from "@/lib/guards";
import { getViewMode } from "@/lib/preferences";
import { listCategories } from "@/lib/repos/categories";
import {
  summarizeByCategory,
  type CategoryTotalRow,
} from "@/lib/repos/transactions";
import { cn } from "@/lib/utils";
import { CategoryBreakdownCard, type ReportGroup } from "./category-breakdown";
import { MonthPicker } from "./month-picker";

function monthBoundsFromString(month: string) {
  const [yStr, mStr] = month.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: fmt(first), to: fmt(last) };
}

function currentMonthISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function isValidMonth(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

function formatMonthLabel(month: string): string {
  const [yStr, mStr] = month.split("-");
  const d = new Date(Number(yStr), Number(mStr) - 1, 1);
  const label = d.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  const view = await getViewMode();

  const params = await searchParams;
  const month =
    params.month && isValidMonth(params.month)
      ? params.month
      : currentMonthISO();
  const { from, to } = monthBoundsFromString(month);

  const [rows, categories] = await Promise.all([
    summarizeByCategory(orgId, { from, to, ownerId: userId }, { view }),
    listCategories(orgId, { includeArchived: true }),
  ]);

  const incomeRows = rows.filter((r) => r.kind === "income");
  const expenseRows = rows.filter((r) => r.kind === "expense");
  const incomeTotal = incomeRows.reduce(
    (s, r) => s + Number(r.total || 0),
    0,
  );
  const expenseTotal = expenseRows.reduce(
    (s, r) => s + Number(r.total || 0),
    0,
  );
  const net = incomeTotal - expenseTotal;

  const incomeGroups = buildGroups(incomeRows, categories);
  const expenseGroups = buildGroups(expenseRows, categories);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Relatórios</h1>
          <p className="text-muted-foreground">
            Receitas e despesas de {formatMonthLabel(month)} por categoria.
          </p>
        </div>
        <MonthPicker month={month} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Receitas</CardDescription>
            <CardTitle className="text-2xl tabular-nums text-emerald-600">
              {formatBRL(incomeTotal.toFixed(2))}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Despesas</CardDescription>
            <CardTitle className="text-2xl tabular-nums text-rose-600">
              {formatBRL(expenseTotal.toFixed(2))}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Saldo do mês</CardDescription>
            <CardTitle
              className={cn(
                "text-2xl tabular-nums",
                net >= 0 ? "text-emerald-600" : "text-rose-600",
              )}
            >
              {net >= 0 ? "+" : "−"}
              {formatBRL(Math.abs(net).toFixed(2))}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <CategoryBreakdownCard
          title="Receitas por categoria"
          icon={<TrendingUp className="size-4 text-emerald-600" />}
          groups={incomeGroups}
          total={incomeTotal}
          tone="income"
        />
        <CategoryBreakdownCard
          title="Despesas por categoria"
          icon={<TrendingDown className="size-4 text-rose-600" />}
          groups={expenseGroups}
          total={expenseTotal}
          tone="expense"
        />
      </div>
    </div>
  );
}

type CategoryRecord = {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
};

function buildGroups(
  rows: CategoryTotalRow[],
  categories: CategoryRecord[],
): ReportGroup[] {
  const catById = new Map<string, CategoryRecord>();
  for (const c of categories) catById.set(c.id, c);

  const groups = new Map<string, ReportGroup>();
  const ensureGroup = (
    rootId: string | null,
    rootName: string,
    rootColor: string | null,
  ): ReportGroup => {
    const key = rootId ?? "__none__";
    let g = groups.get(key);
    if (!g) {
      g = {
        rootId,
        rootName,
        rootColor,
        directTotal: 0,
        childrenTotal: 0,
        total: 0,
        children: [],
      };
      groups.set(key, g);
    }
    return g;
  };

  for (const r of rows) {
    const value = Number(r.total || 0);
    if (!r.categoryId) {
      const g = ensureGroup(null, "Sem categoria", null);
      g.directTotal += value;
      g.total += value;
      continue;
    }
    const cat = catById.get(r.categoryId);
    if (!cat) {
      const g = ensureGroup(
        r.categoryId,
        r.categoryName ?? "Categoria removida",
        r.categoryColor ?? null,
      );
      g.directTotal += value;
      g.total += value;
      continue;
    }
    if (cat.parentId && catById.has(cat.parentId)) {
      const parent = catById.get(cat.parentId)!;
      const g = ensureGroup(parent.id, parent.name, parent.color);
      g.children.push({
        id: cat.id,
        name: cat.name,
        color: cat.color,
        total: value,
      });
      g.childrenTotal += value;
      g.total += value;
    } else {
      const g = ensureGroup(cat.id, cat.name, cat.color);
      g.directTotal += value;
      g.total += value;
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.total - a.total);
}
