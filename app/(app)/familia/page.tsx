import Link from "next/link";
import { Settings } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatBRL, formatDate } from "@/lib/format";
import { requireOrganization } from "@/lib/guards";
import { isAdmin, getMemberRole } from "@/lib/auth-permissions";
import { getViewMode } from "@/lib/preferences";
import {
  colorForUser,
  initialsForName,
  listFamilyMembers,
} from "@/lib/repos/members";
import {
  listTransactions,
  pendingCardSpend,
  summarizeRange,
  totalBalance,
} from "@/lib/repos/transactions";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthBounds() {
  const today = new Date();
  return {
    from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: ymd(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
  };
}

export default async function FamiliaPage() {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  const role = await getMemberRole(orgId, userId);
  const { from, to } = monthBounds();
  const view = await getViewMode();

  const members = await listFamilyMembers(orgId);

  const [familyBalance, familySummary, familyPending, recent, perMember] =
    await Promise.all([
      totalBalance(orgId),
      summarizeRange(orgId, { from, to }, { view }),
      pendingCardSpend(orgId, { from, to }, { view }),
      listTransactions(orgId, { from, to }, { view }),
      Promise.all(
        members.map(async (m) => {
          const [balance, summary, pending] = await Promise.all([
            totalBalance(orgId, { ownerId: m.userId }),
            summarizeRange(orgId, { from, to, ownerId: m.userId }, { view }),
            pendingCardSpend(
              orgId,
              { from, to, ownerId: m.userId },
              { view },
            ),
          ]);
          return { member: m, balance, summary, pending };
        }),
      ),
    ]);

  const familyIncomeCents = Math.round(Number(familySummary.income) * 100);
  const familyExpenseCents = Math.round(Number(familySummary.expense) * 100);
  const familyNetCents = familyIncomeCents - familyExpenseCents;
  const familyNet = (familyNetCents / 100).toFixed(2);

  const userById = new Map(members.map((m) => [m.userId, m]));

  const recentTop = recent.slice(0, 12);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Família</h1>
          <p className="text-muted-foreground">
            Visão consolidada de {members.length} membro
            {members.length === 1 ? "" : "s"} ·{" "}
            {formatDate(`${from}T00:00:00`)} a {formatDate(`${to}T00:00:00`)}
          </p>
        </div>
        {isAdmin(role) ? (
          <Link
            href="/familia/membros"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Settings className="size-4" />
            Gerenciar membros
          </Link>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Saldo da família</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {formatBRL(familyBalance)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Receitas (mês)</CardDescription>
            <CardTitle className="text-2xl tabular-nums text-emerald-600">
              {formatBRL(familySummary.income)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Despesas (mês)</CardDescription>
            <CardTitle className="text-2xl tabular-nums text-rose-600">
              {formatBRL(familySummary.expense)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Resultado</CardDescription>
            <CardTitle
              className={`text-2xl tabular-nums ${
                familyNetCents >= 0 ? "text-emerald-600" : "text-rose-600"
              }`}
            >
              {formatBRL(familyNet)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {Number(familyPending) > 0 ? (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-900/10 p-3 text-sm">
          Despesas pendentes de cartão na família este mês:{" "}
          <span className="font-medium text-amber-700 dark:text-amber-500">
            {formatBRL(familyPending)}
          </span>
        </div>
      ) : null}

      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          Por membro
        </h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {perMember.map(({ member, balance, summary, pending }) => {
            const incomeCents = Math.round(Number(summary.income) * 100);
            const expenseCents = Math.round(Number(summary.expense) * 100);
            const netCents = incomeCents - expenseCents;
            const net = (netCents / 100).toFixed(2);
            const color = colorForUser(member.userId);
            return (
              <Card
                key={member.memberId}
                className="border-l-4"
                style={{ borderLeftColor: color }}
              >
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <Avatar className="size-9">
                      {member.image ? (
                        <AvatarImage src={member.image} alt={member.name} />
                      ) : null}
                      <AvatarFallback style={{ backgroundColor: color, color: "#fff" }}>
                        {initialsForName(member.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base truncate">
                        {member.name}
                      </CardTitle>
                      <CardDescription className="truncate text-xs">
                        {member.role === "owner"
                          ? "Dono"
                          : member.role === "admin"
                            ? "Admin"
                            : "Membro"}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1.5 text-sm tabular-nums">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Saldo</span>
                    <span className="font-medium">{formatBRL(balance)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Receitas</span>
                    <span className="text-emerald-600">
                      {formatBRL(summary.income)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Despesas</span>
                    <span className="text-rose-600">
                      {formatBRL(summary.expense)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t pt-1.5">
                    <span className="text-muted-foreground">Resultado</span>
                    <span
                      className={
                        netCents >= 0 ? "text-emerald-600" : "text-rose-600"
                      }
                    >
                      {formatBRL(net)}
                    </span>
                  </div>
                  {Number(pending) > 0 ? (
                    <div className="flex justify-between text-xs text-amber-700 dark:text-amber-500">
                      <span>Pendente cartão</span>
                      <span>{formatBRL(pending)}</span>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          Movimentações recentes da família
        </h2>
        {recentTop.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nenhuma movimentação no mês.
          </div>
        ) : (
          <div className="rounded-lg border divide-y">
            {recentTop.map((t) => {
              const owner = userById.get(
                (t as unknown as { ownerId?: string }).ownerId ?? "",
              );
              const ownerName = owner?.name ?? "—";
              const ownerColor = owner
                ? colorForUser(owner.userId)
                : "var(--muted-foreground)";
              return (
                <div
                  key={t.id}
                  className="flex items-center gap-3 px-3 py-2 text-sm"
                >
                  <span
                    aria-hidden
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium text-white"
                    style={{ backgroundColor: ownerColor }}
                    title={ownerName}
                  >
                    {owner ? initialsForName(owner.name) : "?"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">
                      {t.cleanDescription ?? t.description}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {ownerName}
                      {t.account ? ` · ${t.account.name}` : ""}
                      {t.category ? ` · ${t.category.name}` : ""}
                    </div>
                  </div>
                  <div
                    className={`tabular-nums font-medium ${
                      t.kind === "income"
                        ? "text-emerald-600"
                        : t.kind === "expense"
                          ? "text-rose-600"
                          : ""
                    }`}
                  >
                    {t.kind === "income"
                      ? "+"
                      : t.kind === "expense"
                        ? "−"
                        : ""}
                    {formatBRL(t.amount)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
