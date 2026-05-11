import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatBRL, formatDate } from "@/lib/format";
import { requireOrganization } from "@/lib/guards";
import { listAccounts } from "@/lib/repos/accounts";
import { listPendingTransfersForUser } from "@/lib/repos/transfer-requests";
import { PendingTransferActions } from "./pending-transfer-actions";

export default async function TransferenciasPage() {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const [pending, myAccounts] = await Promise.all([
    listPendingTransfersForUser(orgId, userId),
    listAccounts(orgId, { ownerId: userId }),
  ]);

  const eligibleAccounts = myAccounts
    .filter((a) => a.type !== "credit_card")
    .map((a) => ({ id: a.id, name: a.name, type: a.type }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Transferências</h1>
        <p className="text-muted-foreground">
          Solicitações de outros membros aguardando seu aceite.
        </p>
      </div>

      {pending.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nenhuma transferência pendente</CardTitle>
            <CardDescription>
              Quando outro membro lançar uma transferência para uma conta sua,
              ela aparece aqui para você confirmar.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {pending.map((p) => {
            const sentByMe = false; // sempre é de outro membro
            void sentByMe;
            const direction =
              p.kind === "expense"
                ? `${p.requesterName ?? "Outro membro"} enviou para você`
                : `${p.requesterName ?? "Outro membro"} declarou ter recebido de você`;
            return (
              <Card key={p.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <CardDescription>
                        {formatDate(p.occurredOn)} · {direction}
                      </CardDescription>
                      <CardTitle className="text-2xl tabular-nums">
                        {formatBRL(p.amount)}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {p.description}
                        {p.sourceAccount?.name
                          ? ` · de ${p.sourceAccount.name}`
                          : ""}
                        {p.destAccount?.name
                          ? ` → ${p.destAccount.name}`
                          : ""}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <PendingTransferActions
                    pendingId={p.id}
                    suggestedDestAccountId={p.destAccount?.id ?? null}
                    accounts={eligibleAccounts}
                  />
                </CardContent>
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}
