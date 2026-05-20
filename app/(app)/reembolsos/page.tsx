import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatBRL } from "@/lib/format";
import { listAccounts } from "@/lib/repos/accounts";
import {
  listIncomeCandidatesForReimbursement,
  listReimbursements,
} from "@/lib/repos/reimbursements";
import { requireOrganization } from "@/lib/guards";
import { ReimbursementsTable } from "./reimbursements-table";

type SearchParams = Promise<{ tab?: string }>;

export default async function ReembolsosPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const params = await searchParams;
  const tabRaw = params.tab;
  const tab: "pending" | "reimbursed" | "all" =
    tabRaw === "reimbursed" || tabRaw === "all" ? tabRaw : "pending";

  const filter =
    tab === "pending"
      ? { status: "pending" as const }
      : tab === "reimbursed"
        ? { status: "reimbursed" as const }
        : {};

  const [items, incomeCandidates, accounts] = await Promise.all([
    listReimbursements(orgId, filter),
    listIncomeCandidatesForReimbursement(orgId),
    listAccounts(orgId),
  ]);

  // Para resumo: precisamos da lista completa, ignora o filtro de tab
  const allItems =
    tab === "all" ? items : await listReimbursements(orgId, {});

  let pendingCents = 0;
  let reimbursedCents = 0;
  for (const it of allItems) {
    const cents = Math.round(Number(it.expense.amount) * 100);
    if (it.status === "pending") pendingCents += cents;
    else reimbursedCents += cents;
  }
  const pendingTotal = (pendingCents / 100).toFixed(2);
  const reimbursedTotal = (reimbursedCents / 100).toFixed(2);
  const pendingCount = allItems.filter((it) => it.status === "pending").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reembolsos</h1>
        <p className="text-muted-foreground">
          Compras reembolsáveis e seu status. Estas despesas ficam fora dos
          relatórios de gastos.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Aguardando reembolso</CardDescription>
            <CardTitle className="text-2xl tabular-nums text-amber-600">
              {formatBRL(pendingTotal)}
            </CardTitle>
            <CardDescription className="text-xs">
              {pendingCount} compra{pendingCount === 1 ? "" : "s"}
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Já reembolsado</CardDescription>
            <CardTitle className="text-2xl tabular-nums text-emerald-600">
              {formatBRL(reimbursedTotal)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Total registrado</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {allItems.length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <ReimbursementsTable
        items={items}
        tab={tab}
        incomeCandidates={incomeCandidates}
        accounts={accounts.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          color: a.color,
        }))}
      />
    </div>
  );
}
