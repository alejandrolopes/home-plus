"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { financialAccount, transaction } from "@/db/schema/finance";
import { requireOrganization } from "@/lib/guards";
import { canEdit, getMemberRole } from "@/lib/auth-permissions";

const splitItem = z.object({
  kind: z.enum(["income", "expense"]),
  categoryId: z.string().uuid().nullable().or(z.literal("")),
  description: z.string().max(200).nullable().or(z.literal("")),
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .transform((v) => v.replace(",", ".")),
  isTithable: z.boolean().optional(),
});

export type SplitInput = z.infer<typeof splitItem>;

export async function saveSplitsAction(
  parentId: string,
  splits: SplitInput[],
): Promise<{ ok: true } | { error: string }> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const parsed = z.array(splitItem).safeParse(splits);
  if (!parsed.success) return { error: "Splits inválidos." };
  const items = parsed.data;

  const [parent] = await db
    .select()
    .from(transaction)
    .where(
      and(eq(transaction.id, parentId), eq(transaction.organizationId, orgId)),
    )
    .limit(1);
  if (!parent) return { error: "Lançamento pai não encontrado." };
  const role = await getMemberRole(orgId, userId);
  if (!canEdit({ ownerId: parent.ownerId }, userId, role)) {
    return { error: "Sem permissão para dividir este lançamento." };
  }
  if (parent.parentTransactionId)
    return { error: "Este lançamento já é filho de um split." };
  if (parent.kind === "transfer")
    return { error: "Transferências não podem ser divididas." };
  if (parent.installmentNumber != null)
    return { error: "Parcelas não podem ser divididas." };

  // Empty array = remove all splits (revert to simple transaction)
  if (items.length === 0) {
    await db.transaction(async (tx) => {
      await tx
        .delete(transaction)
        .where(
          and(
            eq(transaction.organizationId, orgId),
            eq(transaction.parentTransactionId, parentId),
          ),
        );
    });
    revalidatePath("/lancamentos");
    revalidatePath("/dashboard");
    return { ok: true };
  }

  // Validate signed sum vs parent
  let netCents = 0;
  for (const it of items) {
    const cents = Math.round(Number(it.amount) * 100);
    if (cents <= 0)
      return { error: "Cada split deve ter valor positivo maior que zero." };
    netCents += it.kind === "income" ? cents : -cents;
  }
  const parentCents = Math.round(Number(parent.amount) * 100);
  const expectedCents = parent.kind === "income" ? parentCents : -parentCents;

  if (Math.abs(netCents - expectedCents) > 1) {
    const diffCents = Math.abs(netCents - expectedCents);
    const diff = (diffCents / 100).toFixed(2);
    return {
      error: `Soma dos splits diverge em R$ ${diff} do total do lançamento (esperado R$ ${parent.amount}).`,
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(transaction)
      .where(
        and(
          eq(transaction.organizationId, orgId),
          eq(transaction.parentTransactionId, parentId),
        ),
      );

    for (const it of items) {
      await tx.insert(transaction).values({
        organizationId: orgId,
        accountId: parent.accountId,
        kind: it.kind,
        amount: it.amount,
        description: it.description || parent.description,
        cleanDescription: it.description || parent.cleanDescription,
        occurredOn: parent.occurredOn,
        purchaseDate: parent.purchaseDate ?? parent.occurredOn,
        categoryId: it.categoryId && it.categoryId !== "" ? it.categoryId : null,
        parentTransactionId: parentId,
        isTithable: it.kind === "income" && !!it.isTithable,
        createdById: userId,
        ownerId: parent.ownerId,
      });
    }

    await tx
      .update(transaction)
      .set({ categoryId: null, isTithable: false, updatedAt: new Date() })
      .where(eq(transaction.id, parentId));
  });

  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  return { ok: true };
}

const createWithSplitsSchema = z.object({
  accountId: z.string().uuid(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  description: z.string().min(1).max(200),
  kind: z.enum(["income", "expense"]),
});

export async function createTransactionWithSplitsAction(args: {
  accountId: string;
  occurredOn: string;
  amount: string;
  description: string;
  kind: "income" | "expense";
  splits: SplitInput[];
}): Promise<{ ok: true; id: string } | { error: string }> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const baseParsed = createWithSplitsSchema.safeParse({
    accountId: args.accountId,
    occurredOn: args.occurredOn,
    amount: args.amount,
    description: args.description,
    kind: args.kind,
  });
  if (!baseParsed.success) return { error: "Dados inválidos." };

  const splitsParsed = z.array(splitItem).safeParse(args.splits);
  if (!splitsParsed.success) return { error: "Splits inválidos." };
  const items = splitsParsed.data;
  if (items.length === 0) return { error: "Forneça pelo menos um split." };

  const [acc] = await db
    .select({
      id: financialAccount.id,
      type: financialAccount.type,
      ownerId: financialAccount.ownerId,
    })
    .from(financialAccount)
    .where(
      and(
        eq(financialAccount.id, baseParsed.data.accountId),
        eq(financialAccount.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!acc) return { error: "Conta não encontrada." };
  const role = await getMemberRole(orgId, userId);
  if (!canEdit({ ownerId: acc.ownerId }, userId, role)) {
    return { error: "Sem permissão para criar lançamento nesta conta." };
  }
  if (acc.type === "credit_card")
    return { error: "Não é possível criar contra-cheque em cartão." };

  // Validate signed sum
  let netCents = 0;
  for (const it of items) {
    const cents = Math.round(Number(it.amount) * 100);
    if (cents <= 0)
      return { error: "Cada split deve ter valor positivo maior que zero." };
    netCents += it.kind === "income" ? cents : -cents;
  }
  const parentCents = Math.round(Number(baseParsed.data.amount) * 100);
  const expectedCents =
    baseParsed.data.kind === "income" ? parentCents : -parentCents;
  if (Math.abs(netCents - expectedCents) > 1) {
    const diff = (Math.abs(netCents - expectedCents) / 100).toFixed(2);
    return {
      error: `Soma dos splits diverge em R$ ${diff} do total do lançamento.`,
    };
  }

  let parentId = "";
  await db.transaction(async (tx) => {
    const [parent] = await tx
      .insert(transaction)
      .values({
        organizationId: orgId,
        accountId: baseParsed.data.accountId,
        kind: baseParsed.data.kind,
        amount: baseParsed.data.amount,
        description: baseParsed.data.description,
        cleanDescription: baseParsed.data.description,
        occurredOn: baseParsed.data.occurredOn,
        purchaseDate: baseParsed.data.occurredOn,
        createdById: userId,
        ownerId: acc.ownerId,
      })
      .returning({ id: transaction.id });
    parentId = parent.id;

    for (const it of items) {
      await tx.insert(transaction).values({
        organizationId: orgId,
        accountId: baseParsed.data.accountId,
        kind: it.kind,
        amount: it.amount,
        description: it.description || baseParsed.data.description,
        cleanDescription: it.description || baseParsed.data.description,
        occurredOn: baseParsed.data.occurredOn,
        purchaseDate: baseParsed.data.occurredOn,
        categoryId:
          it.categoryId && it.categoryId !== "" ? it.categoryId : null,
        parentTransactionId: parentId,
        isTithable: it.kind === "income" && !!it.isTithable,
        createdById: userId,
        ownerId: acc.ownerId,
      });
    }
  });

  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  return { ok: true, id: parentId };
}
