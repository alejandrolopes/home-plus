"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { category } from "@/db/schema/finance";
import { and, eq } from "drizzle-orm";
import { requireOrganization } from "@/lib/guards";
import { setBudget } from "@/lib/repos/budgets";

const schema = z.object({
  categoryId: z.string().uuid(),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .nullable()
    .optional(),
  amount: z
    .string()
    .regex(/^-?\d+([.,]\d{1,2})?$/, "Valor inválido")
    .transform((v) => v.replace(",", ".")),
});

export type SaveBudgetState =
  | { error?: string; success?: boolean }
  | null;

export async function saveBudgetAction(
  formData: FormData,
): Promise<SaveBudgetState> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  const monthRaw = String(formData.get("month") ?? "");
  const parsed = schema.safeParse({
    categoryId: String(formData.get("categoryId") ?? ""),
    month: monthRaw === "" || monthRaw === "default" ? null : monthRaw,
    amount: String(formData.get("amount") ?? "0"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { categoryId, month, amount } = parsed.data;

  // Confirma que a categoria pertence à org (evita escrita cross-org).
  const [cat] = await db
    .select({ id: category.id })
    .from(category)
    .where(
      and(eq(category.id, categoryId), eq(category.organizationId, orgId)),
    )
    .limit(1);
  if (!cat) return { error: "Categoria não encontrada." };

  const cents = Math.round(Number(amount) * 100);
  if (!Number.isFinite(cents) || cents < 0) {
    return { error: "Valor inválido." };
  }

  await setBudget(orgId, categoryId, month ?? null, cents);
  revalidatePath("/orcamento");
  revalidatePath("/dashboard");
  return { success: true };
}
