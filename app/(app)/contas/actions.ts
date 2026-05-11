"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  creditCardInvoice,
  financialAccount,
  transaction,
} from "@/db/schema/finance";
import { requireOrganization } from "@/lib/guards";
import { canEdit, getMemberRole } from "@/lib/auth-permissions";

const baseSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "Informe o nome").max(80),
  type: z.enum(["checking", "savings", "cash", "credit_card", "investment"]),
  initialBalance: z
    .string()
    .regex(/^-?\d+([.,]\d{1,2})?$/, "Valor inválido")
    .transform((v) => v.replace(",", ".")),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
  closingDay: z.coerce.number().int().min(1).max(31).optional(),
  dueDay: z.coerce.number().int().min(1).max(31).optional(),
  creditLimit: z
    .string()
    .regex(/^\d+([.,]\d{1,2})?$/, "Limite inválido")
    .transform((v) => v.replace(",", "."))
    .optional()
    .or(z.literal("")),
  bankName: z.string().max(80).optional().or(z.literal("")),
  bankId: z.string().max(20).optional().or(z.literal("")),
  accountNumber: z.string().max(40).optional().or(z.literal("")),
  accountBranch: z.string().max(20).optional().or(z.literal("")),
});

const schema = baseSchema.refine(
  (data) =>
    data.type !== "credit_card" ||
    (data.closingDay != null && data.dueDay != null),
  {
    message: "Cartão precisa de dia de fechamento e vencimento.",
    path: ["closingDay"],
  },
);

export type AccountFormState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
  success?: boolean;
} | null;

export async function saveAccountAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  const role = await getMemberRole(orgId, userId);

  const raw = Object.fromEntries(formData);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "_");
      fieldErrors[key] = issue.message;
    }
    return { error: "Verifique os campos.", fieldErrors };
  }

  const data = parsed.data;
  const isCard = data.type === "credit_card";

  const values = {
    name: data.name,
    type: data.type,
    initialBalance: data.initialBalance,
    color: data.color || null,
    closingDay: isCard ? data.closingDay! : null,
    dueDay: isCard ? data.dueDay! : null,
    creditLimit: isCard && data.creditLimit ? data.creditLimit : null,
    bankName: data.bankName || null,
    bankId: data.bankId || null,
    accountNumber: data.accountNumber || null,
    accountBranch: data.accountBranch || null,
  };

  if (data.id) {
    const [existing] = await db
      .select({ ownerId: financialAccount.ownerId })
      .from(financialAccount)
      .where(
        and(
          eq(financialAccount.id, data.id),
          eq(financialAccount.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!existing) return { error: "Conta não encontrada." };
    if (!canEdit({ ownerId: existing.ownerId }, userId, role)) {
      return { error: "Sem permissão para editar esta conta." };
    }
    await db
      .update(financialAccount)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(
          eq(financialAccount.id, data.id),
          eq(financialAccount.organizationId, orgId),
        ),
      );
  } else {
    await db.insert(financialAccount).values({
      organizationId: orgId,
      ownerId: userId,
      ...values,
    });
  }

  revalidatePath("/contas");
  return { success: true };
}

export async function deleteAccountAction(
  id: string,
  mode: "delete_transactions" | "orphan_transactions",
): Promise<{ ok: true } | { error: string }> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  const role = await getMemberRole(orgId, userId);

  const [acc] = await db
    .select({
      id: financialAccount.id,
      type: financialAccount.type,
      ownerId: financialAccount.ownerId,
    })
    .from(financialAccount)
    .where(
      and(
        eq(financialAccount.id, id),
        eq(financialAccount.organizationId, orgId),
      ),
    )
    .limit(1);

  if (!acc) return { error: "Conta não encontrada." };
  if (!canEdit({ ownerId: acc.ownerId }, userId, role)) {
    return { error: "Sem permissão para excluir esta conta." };
  }

  await db.transaction(async (tx) => {
    if (mode === "delete_transactions") {
      await tx
        .delete(transaction)
        .where(
          and(
            eq(transaction.accountId, id),
            eq(transaction.organizationId, orgId),
          ),
        );
    }
    if (acc.type === "credit_card") {
      await tx
        .delete(creditCardInvoice)
        .where(
          and(
            eq(creditCardInvoice.accountId, id),
            eq(creditCardInvoice.organizationId, orgId),
          ),
        );
    }
    await tx
      .delete(financialAccount)
      .where(
        and(
          eq(financialAccount.id, id),
          eq(financialAccount.organizationId, orgId),
        ),
      );
  });

  revalidatePath("/contas");
  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  revalidatePath("/cartoes");
  return { ok: true };
}

async function setArchivedFlag(
  formData: FormData,
  archived: boolean,
): Promise<void> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  const role = await getMemberRole(orgId, userId);
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const [acc] = await db
    .select({ ownerId: financialAccount.ownerId })
    .from(financialAccount)
    .where(
      and(
        eq(financialAccount.id, id),
        eq(financialAccount.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!acc) return;
  if (!canEdit({ ownerId: acc.ownerId }, userId, role)) return;

  await db
    .update(financialAccount)
    .set({ archived, updatedAt: new Date() })
    .where(
      and(
        eq(financialAccount.id, id),
        eq(financialAccount.organizationId, orgId),
      ),
    );

  revalidatePath("/contas");
}

export async function archiveAccountAction(formData: FormData) {
  await setArchivedFlag(formData, true);
}

export async function unarchiveAccountAction(formData: FormData) {
  await setArchivedFlag(formData, false);
}

/**
 * Retorna os movimentos top-level (parent_transaction_id IS NULL) da conta,
 * agrupados por kind. Usado pelo painel de calibração pra mostrar a
 * matemática ao usuário antes de clicar Aplicar.
 */
export async function getAccountMovementsAction(
  accountId: string,
): Promise<
  | { income: string; expense: string; initialBalance: string }
  | { error: string }
> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  if (!accountId || !/^[0-9a-f-]{36}$/i.test(accountId)) {
    return { error: "Conta inválida." };
  }

  const [account] = await db
    .select({ id: financialAccount.id, initialBalance: financialAccount.initialBalance })
    .from(financialAccount)
    .where(
      and(
        eq(financialAccount.id, accountId),
        eq(financialAccount.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!account) return { error: "Conta não encontrada." };

  const rows = await db
    .select({
      kind: transaction.kind,
      total: sql<string>`COALESCE(SUM(${transaction.amount}), 0)`,
    })
    .from(transaction)
    .where(
      and(
        eq(transaction.organizationId, orgId),
        eq(transaction.accountId, accountId),
        isNull(transaction.parentTransactionId),
      ),
    )
    .groupBy(transaction.kind);

  let income = "0";
  let expense = "0";
  for (const r of rows) {
    if (r.kind === "income") income = r.total;
    else if (r.kind === "expense") expense = r.total;
  }
  return { income, expense, initialBalance: account.initialBalance };
}

/**
 * Calcula qual deve ser o saldo inicial da conta pra que, somando o histórico
 * de movimentos importados, o resultado bata com o saldo atual informado pelo
 * usuário (geralmente lido do internet banking).
 *
 *   currentBalance = initialBalance + Σincome − Σexpense   (parents top-level)
 *   ⇒ initialBalance = currentBalance − Σincome + Σexpense
 *
 * Não persiste — retorna o valor calculado pra que o form de conta o aplique
 * no input e o usuário decida salvar.
 */
export async function computeInitialBalanceAction(
  accountId: string,
  currentBalanceInput: string,
): Promise<{ newInitial: string } | { error: string }> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  if (!accountId || !/^[0-9a-f-]{36}$/i.test(accountId)) {
    return { error: "Conta inválida." };
  }
  const cleaned = currentBalanceInput.replace(",", ".").trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { error: "Saldo atual inválido." };
  }
  const currentCents = Math.round(Number(cleaned) * 100);

  const [account] = await db
    .select({ id: financialAccount.id, ownerId: financialAccount.ownerId })
    .from(financialAccount)
    .where(
      and(
        eq(financialAccount.id, accountId),
        eq(financialAccount.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!account) return { error: "Conta não encontrada." };

  const movementRows = await db
    .select({
      kind: transaction.kind,
      total: sql<string>`COALESCE(SUM(${transaction.amount}), 0)`,
    })
    .from(transaction)
    .where(
      and(
        eq(transaction.organizationId, orgId),
        eq(transaction.accountId, accountId),
        isNull(transaction.parentTransactionId),
      ),
    )
    .groupBy(transaction.kind);

  let movementCents = 0;
  for (const r of movementRows) {
    const cents = Math.round(Number(r.total) * 100);
    if (r.kind === "income") movementCents += cents;
    else if (r.kind === "expense") movementCents -= cents;
  }

  const newInitialCents = currentCents - movementCents;
  const newInitial = (newInitialCents / 100).toFixed(2);

  return { newInitial };
}
