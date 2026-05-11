import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatBRL, todayISO } from "@/lib/format";
import {
  listAccounts,
  listFamilyAccountsForTransfer,
} from "@/lib/repos/accounts";
import { listCategories } from "@/lib/repos/categories";
import {
  listSplitChildrenForParents,
  listTransactions,
  pendingCardSpend,
  summarizeRange,
  type TransactionFilters,
} from "@/lib/repos/transactions";
import { requireOrganization } from "@/lib/guards";
import { getViewMode } from "@/lib/preferences";
import {
  getEffectiveFinanceSettings,
  tithableBaseInRange,
} from "@/lib/repos/finance-settings";
import { LancamentosToolbar } from "./lancamentos-toolbar";
import { TransactionsTable } from "./transactions-table";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function defaultMonthBounds() {
  const today = new Date();
  return {
    from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: ymd(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
  };
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readFilters(
  searchParams: Record<string, string | string[] | undefined>,
): { current: { from: string; to: string; accountId?: string; categoryId?: string; kind?: "income" | "expense" }; query: TransactionFilters } {
  const def = defaultMonthBounds();
  const fromRaw = searchParams.from;
  const toRaw = searchParams.to;
  const accountRaw = searchParams.account;
  const categoryRaw = searchParams.category;
  const kindRaw = searchParams.kind;

  const from =
    typeof fromRaw === "string" && ISO_RE.test(fromRaw) ? fromRaw : def.from;
  const to = typeof toRaw === "string" && ISO_RE.test(toRaw) ? toRaw : def.to;
  const accountId =
    typeof accountRaw === "string" && UUID_RE.test(accountRaw)
      ? accountRaw
      : undefined;
  const categoryId =
    typeof categoryRaw === "string" && UUID_RE.test(categoryRaw)
      ? categoryRaw
      : undefined;
  const kind =
    kindRaw === "income" || kindRaw === "expense" ? kindRaw : undefined;

  return {
    current: { from, to, accountId, categoryId, kind },
    query: { from, to, accountId, categoryId, kind },
  };
}

export default async function LancamentosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  const params = await searchParams;
  const { current, query } = readFilters(params);
  const scopedQuery = { ...query, ownerId: userId };
  const view = await getViewMode();

  const [
    accounts,
    transferAccounts,
    categories,
    transactions,
    summary,
    pending,
    fidelidade,
    tithableBase,
  ] = await Promise.all([
    listAccounts(orgId, { ownerId: userId }),
    listFamilyAccountsForTransfer(orgId),
    listCategories(orgId),
    listTransactions(orgId, scopedQuery, { view }),
    summarizeRange(orgId, scopedQuery, { view }),
    pendingCardSpend(
      orgId,
      { from: query.from, to: query.to, ownerId: userId },
      { view },
    ),
    getEffectiveFinanceSettings(orgId, userId),
    tithableBaseInRange(orgId, {
      from: query.from!,
      to: query.to!,
      ownerId: userId,
    }),
  ]);

  const splitParentIds = transactions
    .filter((t) => t.splitCount > 0)
    .map((t) => t.id);
  const splitsByParent = await listSplitChildrenForParents(
    orgId,
    splitParentIds,
  );

  const incomeCents = Math.round(Number(summary.income) * 100);
  const expenseCents = Math.round(Number(summary.expense) * 100);
  const netCents = incomeCents - expenseCents;
  const net = (netCents / 100).toFixed(2);
  const hasPending = Number(pending) > 0;

  const showFidelidade = fidelidade.tithingEnabled;
  const baseCents = Math.round(Number(tithableBase) * 100);
  const titheCents = Math.round((baseCents * Number(fidelidade.tithingPct)) / 100);
  const pactCents = Math.round((baseCents * Number(fidelidade.pactOfferingPct)) / 100);
  const titheValue = (titheCents / 100).toFixed(2);
  const pactValue = (pactCents / 100).toFixed(2);

  return (
    <div className="space-y-6">
      <LancamentosToolbar
        transactionsCount={transactions.length}
        accounts={accounts.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          color: a.color,
        }))}
        transferAccounts={transferAccounts}
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          color: c.color,
          parentId: c.parentId,
          isTransfer: c.isTransfer,
        }))}
        current={current}
        view={view}
        defaultDate={todayISO()}
        tithingEnabled={fidelidade.tithingEnabled}
      />

      <div
        className={`grid gap-3 ${hasPending ? "md:grid-cols-4" : "md:grid-cols-3"}`}
      >
        <Card>
          <CardHeader>
            <CardDescription>Receitas</CardDescription>
            <CardTitle className="text-2xl tabular-nums text-emerald-600">
              {formatBRL(summary.income)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Despesas</CardDescription>
            <CardTitle className="text-2xl tabular-nums text-rose-600">
              {formatBRL(summary.expense)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Resultado</CardDescription>
            <CardTitle
              className={`text-2xl tabular-nums ${
                netCents >= 0 ? "text-emerald-600" : "text-rose-600"
              }`}
            >
              {formatBRL(net)}
            </CardTitle>
          </CardHeader>
        </Card>
        {hasPending ? (
          <Card className="border-amber-300 dark:border-amber-700">
            <CardHeader>
              <CardDescription className="text-amber-700 dark:text-amber-500">
                Despesas pendentes (cartão)
              </CardDescription>
              <CardTitle className="text-2xl tabular-nums text-amber-600">
                {formatBRL(pending)}
              </CardTitle>
            </CardHeader>
          </Card>
        ) : null}
      </div>

      {showFidelidade ? (
        <div className="rounded-md border bg-muted/30 px-4 py-2.5 flex items-center gap-x-6 gap-y-1 flex-wrap text-sm">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Fidelidade
          </span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs text-muted-foreground">Base</span>
            <span className="tabular-nums font-medium">
              {formatBRL(tithableBase)}
            </span>
          </div>
          <div className="h-4 w-px bg-border hidden sm:block" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs text-amber-700 dark:text-amber-400">
              Dízimo ({fidelidade.tithingPct.replace(".", ",")}%)
            </span>
            <span className="tabular-nums font-medium text-amber-700 dark:text-amber-300">
              {formatBRL(titheValue)}
            </span>
          </div>
          <div className="h-4 w-px bg-border hidden sm:block" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs text-emerald-700 dark:text-emerald-400">
              Oferta pacto ({fidelidade.pactOfferingPct.replace(".", ",")}%)
            </span>
            <span className="tabular-nums font-medium text-emerald-700 dark:text-emerald-300">
              {formatBRL(pactValue)}
            </span>
          </div>
        </div>
      ) : null}

      {transactions.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">
            Nenhum lançamento para o filtro atual.
          </p>
        </div>
      ) : (
        <TransactionsTable
          transactions={transactions}
          splitsByParent={Object.fromEntries(splitsByParent.entries())}
          accounts={accounts.map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            color: a.color,
          }))}
          transferAccounts={transferAccounts}
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
      )}
    </div>
  );
}
