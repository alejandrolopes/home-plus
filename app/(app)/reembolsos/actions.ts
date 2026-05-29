"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { transaction } from "@/db/schema/finance";
import { canEdit, getMemberRole } from "@/lib/auth-permissions";
import { requireOrganization } from "@/lib/guards";

type Result = { ok: true } | { error: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Define o estado de reembolso de um lançamento. Aceita transições livres:
 * none → pending → received → pending → none, etc.
 */
export async function setReimbursableStatusAction(
  txId: string,
  status: "none" | "pending" | "received",
): Promise<Result> {
  if (!UUID_RE.test(txId)) return { error: "Identificador inválido." };
  if (status !== "none" && status !== "pending" && status !== "received") {
    return { error: "Status inválido." };
  }
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  const role = await getMemberRole(orgId, userId);

  const [t] = await db
    .select({
      id: transaction.id,
      ownerId: transaction.ownerId,
    })
    .from(transaction)
    .where(
      and(eq(transaction.id, txId), eq(transaction.organizationId, orgId)),
    )
    .limit(1);
  if (!t) return { error: "Lançamento não encontrado." };
  if (!canEdit({ ownerId: t.ownerId }, userId, role)) {
    return { error: "Sem permissão pra alterar este lançamento." };
  }

  await db
    .update(transaction)
    .set({ reimbursableStatus: status, updatedAt: new Date() })
    .where(eq(transaction.id, txId));

  revalidatePath("/reembolsos");
  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  return { ok: true };
}
