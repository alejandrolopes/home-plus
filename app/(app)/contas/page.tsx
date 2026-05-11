import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  countAccountsByState,
  listAccounts,
  transactionCountsByAccount,
} from "@/lib/repos/accounts";
import { requireOrganization } from "@/lib/guards";
import {
  AccountFormDialog,
  ArchiveButton,
  DeleteAccountDialog,
} from "./account-form";
import {
  archiveAccountAction,
  deleteAccountAction,
  unarchiveAccountAction,
} from "./actions";

const TYPE_LABEL: Record<string, string> = {
  checking: "Corrente",
  savings: "Poupança",
  cash: "Dinheiro",
  credit_card: "Cartão",
  investment: "Investimento",
};

export default async function ContasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  const params = await searchParams;
  const view = params.view === "archived" ? "archived" : "active";

  const [accounts, counts, totals] = await Promise.all([
    listAccounts(orgId, {
      archivedOnly: view === "archived",
      ownerId: userId,
    }),
    transactionCountsByAccount(orgId),
    countAccountsByState(orgId, { ownerId: userId }),
  ]);

  const isArchivedView = view === "archived";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contas</h1>
          <p className="text-muted-foreground">
            Contas correntes, poupança, dinheiro e cartões de crédito.
          </p>
        </div>
        <AccountFormDialog
          trigger={
            <Button>
              <Plus className="size-4" />
              Nova conta
            </Button>
          }
        />
      </div>

      <div className="inline-flex items-center rounded-md border bg-background p-0.5 text-sm">
        <Link
          href="/contas"
          className={cn(
            "rounded px-3 py-1 transition-colors",
            !isArchivedView
              ? "bg-secondary text-secondary-foreground font-medium"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Ativas ({totals.active})
        </Link>
        <Link
          href="/contas?view=archived"
          className={cn(
            "rounded px-3 py-1 transition-colors",
            isArchivedView
              ? "bg-secondary text-secondary-foreground font-medium"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Arquivadas ({totals.archived})
        </Link>
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">
            {isArchivedView
              ? "Nenhuma conta arquivada."
              : "Nenhuma conta cadastrada ainda."}
          </p>
          {!isArchivedView ? (
            <AccountFormDialog
              trigger={
                <Button variant="outline" className="mt-4">
                  <Plus className="size-4" />
                  Cadastrar primeira conta
                </Button>
              }
            />
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Saldo inicial</TableHead>
                <TableHead className="text-right">Limite</TableHead>
                <TableHead className="w-[260px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((acc) => (
                <TableRow key={acc.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {acc.color ? (
                        <span
                          className="inline-block size-3 rounded-full"
                          style={{ backgroundColor: acc.color }}
                        />
                      ) : null}
                      <span
                        className={cn(
                          "font-medium",
                          isArchivedView && "text-muted-foreground",
                        )}
                      >
                        {acc.name}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {TYPE_LABEL[acc.type] ?? acc.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatBRL(acc.initialBalance)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {acc.creditLimit ? formatBRL(acc.creditLimit) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {isArchivedView ? (
                        <ArchiveButton
                          action={unarchiveAccountAction}
                          id={acc.id}
                          label="Desarquivar"
                          confirmText="Restaurar esta conta?"
                        />
                      ) : (
                        <>
                          <AccountFormDialog
                            account={acc}
                            trigger={
                              <Button variant="ghost" size="sm">
                                Editar
                              </Button>
                            }
                          />
                          <ArchiveButton
                            action={archiveAccountAction}
                            id={acc.id}
                          />
                        </>
                      )}
                      <DeleteAccountDialog
                        id={acc.id}
                        name={acc.name}
                        transactionCount={counts.get(acc.id) ?? 0}
                        isCreditCard={acc.type === "credit_card"}
                        deleteAction={deleteAccountAction}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
