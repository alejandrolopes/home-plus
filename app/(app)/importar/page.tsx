import { listAccounts } from "@/lib/repos/accounts";
import { listCategories } from "@/lib/repos/categories";
import { requireOrganization } from "@/lib/guards";
import { HoleriteFlow } from "./holerite-flow";
import { ImportFlow } from "./import-flow";
import { ReparseButton } from "./reparse-button";

export default async function ImportarPage() {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const accounts = await listAccounts(orgId, { ownerId: userId });
  const categories = await listCategories(orgId);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Importar extrato</h1>
        <p className="text-muted-foreground">
          Importe um extrato bancário ou de cartão em OFX ou CSV. Transações
          são deduplicadas pelo identificador único do banco.
        </p>
      </div>
      <ImportFlow
        accounts={accounts.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          bankName: a.bankName,
          closingDay: a.closingDay ?? null,
          dueDay: a.dueDay ?? null,
        }))}
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          parentId: c.parentId,
          color: c.color,
          isTransfer: c.isTransfer,
        }))}
      />

      <HoleriteFlow
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          parentId: c.parentId,
          color: c.color,
        }))}
        bankAccounts={accounts
          .filter((a) => a.type !== "credit_card")
          .map((a) => ({ id: a.id, name: a.name }))}
      />

      <details className="rounded-lg border bg-muted/30 p-4">
        <summary className="text-sm font-medium cursor-pointer text-muted-foreground hover:text-foreground">
          Reprocessar descrições
        </summary>
        <div className="pt-3 space-y-2 text-sm text-muted-foreground">
          <p>
            Re-roda o parser de descrições em todos os lançamentos desta
            família. Útil após melhorar regras de extração ou pra processar
            lançamentos antigos.
          </p>
          <ReparseButton />
        </div>
      </details>
    </div>
  );
}
