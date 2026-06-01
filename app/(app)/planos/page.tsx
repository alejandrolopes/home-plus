import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatBRL, formatDate } from "@/lib/format";
import { requireOrganization } from "@/lib/guards";
import { isModuleEnabled } from "@/lib/modules";
import { listVisiblePlans, type PlanWithProgress } from "@/lib/repos/plans";
import { cn } from "@/lib/utils";
import { ContributionDialog } from "./contribution-dialog";
import { PlanFormDialog } from "./plan-form";

const STATUS_LABEL: Record<PlanWithProgress["status"], string> = {
  on_track: "No prumo",
  ahead: "Adiantado",
  behind: "Atrasado",
  completed: "Concluído",
};

const STATUS_CLASS: Record<PlanWithProgress["status"], string> = {
  on_track: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  ahead: "border-sky-300 text-sky-700 dark:text-sky-400",
  behind: "border-rose-300 text-rose-700 dark:text-rose-400",
  completed: "border-emerald-500 text-emerald-700 dark:text-emerald-400",
};

export default async function PlanosPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  if (!(await isModuleEnabled(orgId, "planos"))) notFound();

  const params = await searchParams;
  const includeArchived = params.view === "archived";
  const plans = await listVisiblePlans(orgId, userId, { includeArchived });
  const visiblePlans = plans.filter((p) =>
    includeArchived ? p.archived : !p.archived,
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Planos e metas</h1>
          <p className="text-muted-foreground">
            Reserva, viagem, reforma, independência financeira. Defina valor,
            prazo e acompanhe o progresso.
          </p>
        </div>
        <PlanFormDialog
          trigger={
            <Button>
              <Plus className="size-4" />
              Novo plano
            </Button>
          }
        />
      </div>

      <div className="inline-flex items-center rounded-md border bg-background p-0.5 text-sm">
        <Link
          href="/planos"
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
          href="/planos?view=archived"
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

      {visiblePlans.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">
            {includeArchived
              ? "Nenhum plano arquivado."
              : "Nenhum plano ainda. Comece criando um — pode ser reserva de emergência, uma viagem, reforma da casa..."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visiblePlans.map((p) => (
            <PlanCard key={p.id} plan={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanCard({ plan }: { plan: PlanWithProgress }) {
  const color = plan.color ?? "#0ea5e9";
  const pctR = Math.min(1, plan.progress);
  const target = (plan.targetCents / 100).toFixed(2);
  const current = (plan.currentCents / 100).toFixed(2);
  const remaining = (plan.remainingCents / 100).toFixed(2);
  const monthlyTarget = (plan.monthlyTargetCents / 100).toFixed(2);
  const remainingMonths = Math.max(0, plan.totalMonths - plan.monthsElapsed);

  return (
    <Card className="overflow-hidden">
      <div className="h-1.5" style={{ backgroundColor: color }} aria-hidden />
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Link href={`/planos/${plan.id}`} className="hover:underline">
                {plan.name}
              </Link>
              {plan.ownerId === null ? (
                <Users
                  className="size-3.5 text-muted-foreground"
                  aria-label="Plano da família"
                />
              ) : null}
            </CardTitle>
            {plan.description ? (
              <CardDescription className="mt-0.5 truncate">
                {plan.description}
              </CardDescription>
            ) : null}
          </div>
          <Badge variant="outline" className={STATUS_CLASS[plan.status]}>
            {STATUS_LABEL[plan.status]}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium tabular-nums">
              {formatBRL(current)}
            </span>
            <span className="text-muted-foreground tabular-nums text-xs">
              de {formatBRL(target)} ({Math.round(plan.progress * 100)}%)
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pctR * 100}%`, backgroundColor: color }}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <div className="text-muted-foreground">Falta</div>
            <div className="tabular-nums font-medium">
              {formatBRL(remaining)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Aporte/mês</div>
            <div className="tabular-nums font-medium">
              {formatBRL(monthlyTarget)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Meses restantes</div>
            <div className="tabular-nums font-medium">
              {remainingMonths}/{plan.totalMonths}
            </div>
          </div>
        </div>

        <div className="text-xs text-muted-foreground flex items-center justify-between">
          <span>
            {formatDate(`${plan.startDate}T00:00:00`)} —{" "}
            {formatDate(`${plan.endDate}T00:00:00`)}
          </span>
          <ContributionDialog
            planId={plan.id}
            trigger={
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
                <Plus className="size-3" />
                Aporte
              </Button>
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
