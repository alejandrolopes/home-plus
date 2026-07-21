"use server";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { financialAccount, transaction } from "@/db/schema/finance";
import { requireOrganization } from "@/lib/guards";
import { getMemberRole, isAdmin } from "@/lib/auth-permissions";

export type PayCardState = {
  error?: string;
  success?: boolean;
} | null;

const schema = z.object({
  cardId: z.string().uuid(),
  sourceAccountId: z.string().uuid(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  amount: z
    .string()
    .regex(/^\d+([.,]\d{1,2})?$/, "Valor inválido")
    .transform((v) => v.replace(",", ".")),
});

/**
 * Pagar cartão = transferência da conta de origem para o cartão. Cria duas
 * pernas ligadas (saída da conta, entrada no cartão) marcadas como
 * transferência, então NÃO conta como despesa nos relatórios (o gasto já foi
 * a compra) e reduz o "Você deve" do cartão. Pagamento parcial = valor menor.
 */
export async function payCardAction(
  _prev: PayCardState,
  formData: FormData,
): Promise<PayCardState> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  const role = await getMemberRole(orgId, userId);

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Verifique os campos." };
  const { cardId, sourceAccountId, paidOn, amount } = parsed.data;

  if (cardId === sourceAccountId) {
    return { error: "Conta de origem inválida." };
  }
  if (Number(amount) <= 0) {
    return { error: "Informe um valor maior que zero." };
  }

  const [card] = await db
    .select()
    .from(financialAccount)
    .where(
      and(
        eq(financialAccount.id, cardId),
        eq(financialAccount.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!card || card.type !== "credit_card") {
    return { error: "Cartão não encontrado." };
  }

  const [source] = await db
    .select()
    .from(financialAccount)
    .where(
      and(
        eq(financialAccount.id, sourceAccountId),
        eq(financialAccount.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!source) return { error: "Conta de origem não encontrada." };
  if (source.type === "credit_card") {
    return { error: "A conta de origem não pode ser outro cartão." };
  }
  if (source.ownerId !== userId && !isAdmin(role)) {
    return { error: "Sem permissão para pagar a partir desta conta." };
  }

  const linkId = `transfer:${randomUUID()}`;

  await db.transaction(async (tx) => {
    // Perna da conta de origem: dinheiro sai (despesa/transferência).
    await tx.insert(transaction).values({
      organizationId: orgId,
      accountId: source.id,
      categoryId: null,
      kind: "expense",
      amount,
      description: `Pagamento ${card.name}`,
      occurredOn: paidOn,
      transferToAccountId: card.id,
      externalPaymentId: linkId,
      createdById: userId,
      ownerId: source.ownerId,
    });
    // Perna do cartão: dinheiro entra e abate o que se deve.
    await tx.insert(transaction).values({
      organizationId: orgId,
      accountId: card.id,
      categoryId: null,
      kind: "income",
      amount,
      description: "Pagamento recebido",
      occurredOn: paidOn,
      transferToAccountId: source.id,
      externalPaymentId: linkId,
      createdById: userId,
      ownerId: card.ownerId,
    });
  });

  revalidatePath("/cartoes");
  revalidatePath("/dashboard");
  revalidatePath("/lancamentos");
  revalidatePath("/relatorios");
  return { success: true };
}
