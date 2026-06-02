import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Trash2 } from "lucide-react";
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
import { listAccounts } from "@/lib/repos/accounts";
import { listInvestments } from "@/lib/repos/investments";
import { getPlan } from "@/lib/repos/plans";
import { PlanFormDialog } from "../plan-form";
import { ConfirmForm } from "@/components/confirm-form";
import {
  archivePlanFormAction,
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
  const [plan, accountsRaw, investmentsRaw] = await Promise.all([
    getPlan(orgId, id),
    listAccounts(orgId, { ownerId: userId }),
    listInvestments(orgId, userId),
  ]);
  if (!plan) notFound();

  if (plan.ownerId !== null && plan.ownerId !== userId) notFound();

  const accountOptions = accountsRaw
    .filter((a) => a.type !== "credit_card")
    .map((a) => ({ id: a.id, label: a.name }));
  const investmentOptions = investmentsRaw.map((i) => ({
    id: i.id,
    label: `${i.productName} (${i.institution})`,
  }));

  const color = plan.color ?? "#0ea5e9";
  const target = (plan.targetCents / 100).toFixed(2);
  const current = (plan.effectiveCurrentCents / 100).toFixed(2);
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
              <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground flex-wrap">
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
                accounts={accountOptions}
                investments={investmentOptions}
                plan={{
                  id: plan.id,
                  name: plan.name,
                  description: plan.description,
                  targetCents: plan.targetCents,
                  startDate: plan.startDate,
                  endDate: plan.endDate,
                  color: plan.color,
                  ownerId: plan.ownerId,
                  linkedAccountId: plan.linkedAccountId,
                  linkedInvestmentId: plan.linkedInvestmentId,
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
              <ConfirmForm
                action={deletePlanFormAction}
                message="Apagar este plano? Não dá pra desfazer."
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
              </ConfirmForm>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Acumulado</div>
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
              <div className="text-muted-foreground">Tipo</div>
              <div className="font-medium text-sm">
                {plan.mode === "account"
                  ? "Conta"
                  : plan.mode === "investment"
                    ? "Investimento"
                    : "Manual"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Origem do dinheiro</CardTitle>
          <CardDescription>
            O progresso vem direto do saldo dessa entidade. Pra mexer no
            valor, movimente lá.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {plan.mode === "account" && plan.linkedAccountId ? (
            <div className="flex items-center justify-between gap-2 rounded-md border p-3">
              <div>
                <div className="text-sm font-medium">
                  {plan.linkedAccountName ?? "Conta removida"}
                </div>
                <div className="text-xs text-muted-foreground">
                  Conta sem rendimento. Saldo atual = progresso do plano.
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                render={<Link href="/contas" />}
                nativeButton={false}
              >
                <ExternalLink className="size-3" /> Abrir
              </Button>
            </div>
          ) : plan.mode === "investment" && plan.linkedInvestmentId ? (
            <div className="flex items-center justify-between gap-2 rounded-md border p-3">
              <div>
                <div className="text-sm font-medium">
                  {plan.linkedInvestmentName ?? "Investimento removido"}
                </div>
                <div className="text-xs text-muted-foreground">
                  Produto com rendimento. Saldo do último snapshot = progresso.
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                render={
                  <Link href={`/investimentos/${plan.linkedInvestmentId}`} />
                }
                nativeButton={false}
              >
                <ExternalLink className="size-3" /> Abrir
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Esse plano está em modo manual (legado). Apague e crie de novo
              com vínculo a conta ou investimento.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
