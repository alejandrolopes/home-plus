import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/db";
import { user } from "@/db/schema/auth";
import { formatBRL, formatDate } from "@/lib/format";
import { requireOrganization } from "@/lib/guards";
import { isModuleEnabled } from "@/lib/modules";
import { getPlan, listContributions } from "@/lib/repos/plans";
import { ContributionDialog } from "../contribution-dialog";
import { PlanFormDialog } from "../plan-form";
import {
  archivePlanFormAction,
  deleteContributionFormAction,
  deletePlanFormAction,
} from "../actions";

export default async function PlanDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  if (!(await isModuleEnabled(orgId, "planos"))) notFound();

  const { id } = await params;
  const plan = await getPlan(orgId, id);
  if (!plan) notFound();

  // Acesso: planos pessoais só pra dono; planos de família, qualquer membro
  if (plan.ownerId !== null && plan.ownerId !== userId) notFound();

  const contributions = await listContributions(id);
  // Busca nomes dos contributors em batch
  const contributorIds = Array.from(
    new Set(contributions.map((c) => c.contributorId)),
  );
  const usersById = new Map<string, string>();
  if (contributorIds.length > 0) {
    const users = await db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(inArray(user.id, contributorIds));
    for (const u of users) usersById.set(u.id, u.name);
  }

  const color = plan.color ?? "#0ea5e9";
  const target = (plan.targetCents / 100).toFixed(2);
  const current = (plan.currentCents / 100).toFixed(2);
  const remaining = (plan.remainingCents / 100).toFixed(2);
  const monthlyTarget = (plan.monthlyTargetCents / 100).toFixed(2);
  const pctR = Math.min(1, plan.progress);

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          render={<Link href="/planos" />}
          nativeButton={false}
        >
          <ArrowLeft className="size-3.5" />
          Voltar
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="h-2" style={{ backgroundColor: color }} aria-hidden />
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-2xl">{plan.name}</CardTitle>
              {plan.description ? (
                <CardDescription className="mt-1">
                  {plan.description}
                </CardDescription>
              ) : null}
              <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                <Badge variant="outline">
                  {plan.ownerId === null ? "Família" : "Pessoal"}
                </Badge>
                <span>
                  {formatDate(`${plan.startDate}T00:00:00`)} —{" "}
                  {formatDate(`${plan.endDate}T00:00:00`)}
                </span>
                {plan.archived ? (
                  <Badge variant="secondary">Arquivado</Badge>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <PlanFormDialog
                plan={{
                  id: plan.id,
                  name: plan.name,
                  description: plan.description,
                  targetCents: plan.targetCents,
                  startDate: plan.startDate,
                  endDate: plan.endDate,
                  color: plan.color,
                  ownerId: plan.ownerId,
                }}
                trigger={
                  <Button variant="outline" size="sm">
                    Editar
                  </Button>
                }
              />
              <form action={archivePlanFormAction}>
                <input type="hidden" name="id" value={plan.id} />
                <input
                  type="hidden"
                  name="archived"
                  value={plan.archived ? "false" : "true"}
                />
                <Button type="submit" variant="outline" size="sm">
                  {plan.archived ? "Desarquivar" : "Arquivar"}
                </Button>
              </form>
              <form
                action={deletePlanFormAction}
                onSubmit={(e) => {
                  if (
                    !confirm(
                      "Apagar este plano e todos os aportes vinculados? Não dá pra desfazer.",
                    )
                  )
                    e.preventDefault();
                }}
              >
                <input type="hidden" name="id" value={plan.id} />
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </form>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Arrecadado</div>
                <div className="text-3xl font-bold tabular-nums">
                  {formatBRL(current)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Meta</div>
                <div className="text-lg tabular-nums">{formatBRL(target)}</div>
              </div>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${pctR * 100}%`,
                  backgroundColor: color,
                }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{Math.round(plan.progress * 100)}% concluído</span>
              <span>{formatBRL(remaining)} restantes</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-md border p-2">
              <div className="text-muted-foreground">Aporte alvo / mês</div>
              <div className="tabular-nums font-medium text-sm">
                {formatBRL(monthlyTarget)}
              </div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-muted-foreground">Meses decorridos</div>
              <div className="tabular-nums font-medium text-sm">
                {plan.monthsElapsed} / {plan.totalMonths}
              </div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-muted-foreground">Aportes realizados</div>
              <div className="tabular-nums font-medium text-sm">
                {contributions.length}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Histórico de aportes</CardTitle>
          <ContributionDialog
            planId={plan.id}
            trigger={
              <Button size="sm">
                <Plus className="size-3.5" />
                Aporte
              </Button>
            }
          />
        </CardHeader>
        <CardContent>
          {contributions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum aporte ainda. Comece adicionando um.
            </p>
          ) : (
            <ul className="divide-y">
              {contributions.map((c) => {
                const amount = (c.amountCents / 100).toFixed(2);
                const isWithdraw = c.amountCents < 0;
                return (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm tabular-nums">
                        <span
                          className={
                            isWithdraw ? "text-rose-600" : "text-emerald-600"
                          }
                        >
                          {isWithdraw ? "−" : "+"}
                          {formatBRL(Math.abs(c.amountCents / 100).toFixed(2))}
                        </span>{" "}
                        <span className="text-muted-foreground text-xs ml-1">
                          ·{" "}
                          {formatDate(`${c.occurredOn}T00:00:00`)}
                          {" · "}
                          {usersById.get(c.contributorId) ?? "—"}
                        </span>
                      </div>
                      {c.notes ? (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {c.notes}
                        </div>
                      ) : null}
                    </div>
                    <form action={deleteContributionFormAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
