import Link from "next/link";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableHead } from "@/components/sortable-head";
import { db } from "@/db";
import {
  category,
  financialAccount,
  transaction,
} from "@/db/schema/finance";
import { formatBRL, todayISO } from "@/lib/format";
import { listAccounts } from "@/lib/repos/accounts";
import { listCategories } from "@/lib/repos/categories";
import { getEffectiveFinanceSettings } from "@/lib/repos/finance-settings";
import { requireOrganization } from "@/lib/guards";
import { MonthPicker } from "../relatorios/month-picker";
import { ReimbursableRow, type ReimbursableRowData } from "./reimbursable-row";

type SearchParams = Promise<{
  tab?: string;
  sort?: string;
  dir?: string;
  month?: string;
}>;

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

function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  const label = d.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default async function ReembolsosPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  const params = await searchParams;
  const tab: "pending" | "received" =
    params.tab === "received" ? "received" : "pending";
  const month =
    params.month && isValidMonth(params.month)
      ? params.month
      : currentMonthISO();
  const { from, to } = monthBounds(month);

  const validSorts = ["date", "description", "category", "amount"] as const;
  const sortCol = validSorts.find((s) => s === params.sort);
  const sortDir: "asc" | "desc" = params.dir === "asc" ? "asc" : "desc";
  const dirFn = sortDir === "asc" ? asc : desc;
  const orderClauses = sortCol
    ? [
        sortCol === "date"
          ? dirFn(
              sql`COALESCE(${transaction.purchaseDate}, ${transaction.occurredOn})`,
            )
          : sortCol === "description"
            ? dirFn(
                sql`COALESCE(${transaction.cleanDescription}, ${transaction.description})`,
              )
            : sortCol === "category"
              ? dirFn(sql`COALESCE(${category.name}, '')`)
              : dirFn(sql`${transaction.amount}::numeric`),
      ]
    : [
        desc(
          sql`COALESCE(${transaction.purchaseDate}, ${transaction.occurredOn})`,
        ),
      ];

  const [accounts, categories, fidelidade, rawRows] = await Promise.all([
    listAccounts(orgId, { ownerId: userId }),
    listCategories(orgId),
    getEffectiveFinanceSettings(orgId, userId),
    db
      .select({
        id: transaction.id,
        kind: transaction.kind,
        amount: transaction.amount,
        description: transaction.description,
        cleanDescription: transaction.cleanDescription,
        occurredOn: transaction.occurredOn,
        purchaseDate: transaction.purchaseDate,
        notes: transaction.notes,
        accountId: transaction.accountId,
        categoryId: transaction.categoryId,
        installmentNumber: transaction.installmentNumber,
        isTithable: transaction.isTithable,
        reimbursableStatus: transaction.reimbursableStatus,
        accountName: financialAccount.name,
        accountType: financialAccount.type,
        accountColor: financialAccount.color,
        categoryName: category.name,
        categoryColor: category.color,
      })
      .from(transaction)
      .leftJoin(
        financialAccount,
        eq(financialAccount.id, transaction.accountId),
      )
      .leftJoin(category, eq(category.id, transaction.categoryId))
      .where(
        and(
          eq(transaction.organizationId, orgId),
          inArray(transaction.reimbursableStatus, ["pending", "received"]),
          // Filtra pela data efetiva de exibição (purchase_date pra cartão,
          // occurred_on senão) pra alinhar com o mês mostrado em cada linha.
          gte(
            sql`COALESCE(${transaction.purchaseDate}, ${transaction.occurredOn})`,
            from,
          ),
          lte(
            sql`COALESCE(${transaction.purchaseDate}, ${transaction.occurredOn})`,
            to,
          ),
        ),
      )
      .orderBy(...orderClauses),
  ]);

  const rows: ReimbursableRowData[] = rawRows.map((r) => ({
    id: r.id,
    occurredOn: r.purchaseDate ?? r.occurredOn,
    description: r.description,
    cleanDescription: r.cleanDescription,
    amount: r.amount,
    status: r.reimbursableStatus as "pending" | "received",
    kind: r.kind as "income" | "expense",
    notes: r.notes,
    accountId: r.accountId,
    accountName: r.accountName,
    accountType: r.accountType,
    accountColor: r.accountColor,
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    categoryColor: r.categoryColor,
    isInstallment: r.installmentNumber != null,
    isTithable: !!r.isTithable,
  }));

  let pendingCents = 0;
  let receivedCents = 0;
  for (const r of rows) {
    const cents = Math.round(Number(r.amount) * 100);
    if (r.status === "pending") pendingCents += cents;
    else receivedCents += cents;
  }
  const visible = rows.filter((r) => r.status === tab);

  // Detecção de candidatos pra cada pending: incomes do usuário com mesmo
  // valor e dentro de ±60 dias (preferindo 0 a +60 — reembolso vem depois
  // da compra). Faz UMA query ampla e cruza em JS pra evitar N+1.
  type IncomeCandidate = {
    id: string;
    occurredOn: string;
    amount: string;
    description: string;
    cleanDescription: string | null;
    accountId: string | null;
    accountName: string | null;
  };
  let candidatesByExpenseId = new Map<string, IncomeCandidate[]>();
  if (tab === "pending" && visible.length > 0) {
    // Janela ampla: cobre 60 dias antes/depois do mês selecionado
    const earliest = visible
      .map((v) => v.occurredOn)
      .sort()[0];
    const latest = visible
      .map((v) => v.occurredOn)
      .sort()
      .at(-1)!;
    const shift = (iso: string, days: number) => {
      const d = new Date(`${iso}T00:00:00`);
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const lo = shift(earliest, -60);
    const hi = shift(latest, 60);
    const wantAmounts = Array.from(new Set(visible.map((v) => v.amount)));
    const incomes = await db
      .select({
        id: transaction.id,
        occurredOn: transaction.occurredOn,
        amount: transaction.amount,
        description: transaction.description,
        cleanDescription: transaction.cleanDescription,
        accountId: transaction.accountId,
        accountName: financialAccount.name,
      })
      .from(transaction)
      .leftJoin(
        financialAccount,
        eq(financialAccount.id, transaction.accountId),
      )
      .where(
        and(
          eq(transaction.organizationId, orgId),
          eq(transaction.ownerId, userId),
          eq(transaction.kind, "income"),
          gte(transaction.occurredOn, lo),
          lte(transaction.occurredOn, hi),
          inArray(transaction.amount, wantAmounts),
        ),
      );
    const incomeByAmount = new Map<string, IncomeCandidate[]>();
    for (const i of incomes) {
      const list = incomeByAmount.get(i.amount) ?? [];
      list.push(i);
      incomeByAmount.set(i.amount, list);
    }
    candidatesByExpenseId = new Map();
    for (const v of visible) {
      const list = (incomeByAmount.get(v.amount) ?? []).filter((inc) => {
        const expDate = new Date(`${v.occurredOn}T00:00:00`).getTime();
        const incDate = new Date(`${inc.occurredOn}T00:00:00`).getTime();
        const diffDays = Math.abs(incDate - expDate) / (1000 * 60 * 60 * 24);
        return diffDays <= 60;
      });
      // Ordena: mais recente primeiro (provavelmente é o que importa)
      list.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
      candidatesByExpenseId.set(v.id, list);
    }
  }

  const accountsForForm = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type as "checking" | "savings" | "cash" | "credit_card" | "investment",
  }));
  const categoriesForForm = categories.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    color: c.color,
    parentId: c.parentId,
    isTransfer: c.isTransfer,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reembolsos</h1>
          <p className="text-muted-foreground">
            Lançamentos reembolsáveis do mês. Marque "recebido" quando o
            reembolso chegar; histórico fica aqui pra consulta.
          </p>
        </div>
        <MonthPicker month={month} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Aguardando</CardDescription>
            <CardTitle className="text-2xl tabular-nums text-amber-600">
              {formatBRL((pendingCents / 100).toFixed(2))}
            </CardTitle>
            <CardDescription className="text-xs">
              {rows.filter((r) => r.status === "pending").length} lançamento(s)
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Já recebido (histórico)</CardDescription>
            <CardTitle className="text-2xl tabular-nums text-emerald-600">
              {formatBRL((receivedCents / 100).toFixed(2))}
            </CardTitle>
            <CardDescription className="text-xs">
              {rows.filter((r) => r.status === "received").length} lançamento(s)
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      <div className="flex gap-2 border-b">
        <Link
          href={{
            pathname: "/reembolsos",
            query: { ...params, tab: "pending" },
          }}
          className={`px-3 py-2 text-sm border-b-2 ${tab === "pending" ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Aguardando
        </Link>
        <Link
          href={{
            pathname: "/reembolsos",
            query: { ...params, tab: "received" },
          }}
          className={`px-3 py-2 text-sm border-b-2 ${tab === "received" ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Histórico
        </Link>
      </div>

      <Card>
        {visible.length === 0 ? (
          <CardHeader>
            <CardDescription>
              {tab === "pending"
                ? "Nenhum reembolso pendente. Marque um lançamento como reembolsável no formulário de edição pra aparecer aqui."
                : "Nenhum reembolso recebido ainda."}
            </CardDescription>
          </CardHeader>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead column="date" className="w-24">
                  Data
                </SortableHead>
                <SortableHead column="description" defaultDir="asc">
                  Descrição
                </SortableHead>
                <SortableHead column="category" defaultDir="asc">
                  Categoria
                </SortableHead>
                <TableHead>Conta</TableHead>
                <SortableHead column="amount" className="text-right">
                  Valor
                </SortableHead>
                <TableHead className="w-[180px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => (
                <ReimbursableRow
                  key={r.id}
                  row={r}
                  candidates={candidatesByExpenseId.get(r.id) ?? []}
                  accounts={accountsForForm}
                  categories={categoriesForForm}
                  defaultDate={todayISO()}
                  tithingEnabled={fidelidade.tithingEnabled}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
