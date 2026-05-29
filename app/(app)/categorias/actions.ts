"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { category, transaction } from "@/db/schema/finance";
import { requireOrganization } from "@/lib/guards";

const schema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "Informe o nome").max(60),
  kind: z.enum(["income", "expense"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
  icon: z.string().max(40).optional().or(z.literal("")),
  parentId: z.string().uuid().optional().or(z.literal("")),
  isTransfer: z
    .union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
    .optional()
    .transform((v) => v === "on" || v === "true"),
});

export type CategoryFormState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
  success?: boolean;
} | null;

export async function saveCategoryAction(
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? "_")] = issue.message;
    }
    return { error: "Verifique os campos.", fieldErrors };
  }

  const { id, name, kind, color, icon, parentId, isTransfer } = parsed.data;
  const parentIdValue = parentId ? parentId : null;

  let resolvedKind = kind;

  if (parentIdValue) {
    if (id && parentIdValue === id) {
      return { error: "Categoria não pode ser pai de si mesma." };
    }
    const [parent] = await db
      .select({
        id: category.id,
        kind: category.kind,
        parentId: category.parentId,
      })
      .from(category)
      .where(
        and(
          eq(category.id, parentIdValue),
          eq(category.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!parent) {
      return { error: "Categoria pai inválida." };
    }
    if (parent.parentId) {
      return {
        error: "Subcategorias podem ter apenas 1 nível. Escolha uma categoria-mãe.",
      };
    }
    resolvedKind = parent.kind;

    if (id) {
      const [hasChildren] = await db
        .select({ id: category.id })
        .from(category)
        .where(
          and(
            eq(category.parentId, id),
            eq(category.organizationId, orgId),
          ),
        )
        .limit(1);
      if (hasChildren) {
        return {
          error:
            "Esta categoria tem subcategorias. Mova-as antes de virá-la subcategoria.",
        };
      }
    }
  }

  const values = {
    name,
    kind: resolvedKind,
    color: color || null,
    icon: icon || null,
    parentId: parentIdValue,
    isTransfer: !!isTransfer,
    isReimbursable: false,
  };

  if (id) {
    await db
      .update(category)
      .set(values)
      .where(and(eq(category.id, id), eq(category.organizationId, orgId)));
  } else {
    await db.insert(category).values({ organizationId: orgId, ...values });
  }

  revalidatePath("/categorias");
  revalidatePath("/reembolsos");
  return { success: true };
}

/**
 * Conta transações associadas a uma categoria (e suas subcategorias).
 * Usado pelo dialog de arquivar pra decidir se precisa perguntar o que
 * fazer com os lançamentos.
 */
export async function countTransactionsInCategoryAction(
  categoryId: string,
): Promise<{ count: number }> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  // Coleta todos os ids afetados (categoria + subcategorias)
  const cats = await db
    .select({ id: category.id })
    .from(category)
    .where(
      and(
        eq(category.organizationId, orgId),
        sql`(${category.id} = ${categoryId} OR ${category.parentId} = ${categoryId})`,
      ),
    );
  const ids = cats.map((c) => c.id);
  if (ids.length === 0) return { count: 0 };

  const [r] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(transaction)
    .where(
      and(
        eq(transaction.organizationId, orgId),
        inArray(transaction.categoryId, ids),
      ),
    );
  return { count: r?.n ?? 0 };
}

/**
 * Arquiva uma categoria (e suas subcategorias). Antes de arquivar, move os
 * lançamentos associados pra `reassignToCategoryId` (se informado) ou pra
 * NULL (se vazio/null). Tudo numa transação atômica.
 */
export async function archiveCategoryAction(
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const id = String(formData.get("id") ?? "");
  const reassignRaw = String(formData.get("reassignToCategoryId") ?? "");
  if (!id) return { error: "ID inválido." };

  const reassignTo = reassignRaw && reassignRaw !== "none" ? reassignRaw : null;
  if (reassignTo && reassignTo === id) {
    return { error: "Não pode reatribuir pra a própria categoria." };
  }

  await db.transaction(async (tx) => {
    // Coleta ids afetados (mãe + subcategorias)
    const cats = await tx
      .select({ id: category.id })
      .from(category)
      .where(
        and(
          eq(category.organizationId, orgId),
          sql`(${category.id} = ${id} OR ${category.parentId} = ${id})`,
        ),
      );
    const ids = cats.map((c) => c.id);
    if (ids.length === 0) return;

    // Move lançamentos antes de arquivar (NULL ou pra categoria escolhida)
    await tx
      .update(transaction)
      .set({ categoryId: reassignTo, updatedAt: new Date() })
      .where(
        and(
          eq(transaction.organizationId, orgId),
          inArray(transaction.categoryId, ids),
        ),
      );

    // Arquiva categoria + subcategorias
    await tx
      .update(category)
      .set({ archived: true })
      .where(
        and(eq(category.organizationId, orgId), inArray(category.id, ids)),
      );
  });

  revalidatePath("/categorias");
  revalidatePath("/lancamentos");
  revalidatePath("/reembolsos");
  revalidatePath("/relatorios");
  revalidatePath("/onde-economizar");
  return { success: true };
}

const DEFAULT_INCOME = [
  { name: "Salário", color: "#10b981" },
  { name: "Renda extra", color: "#22c55e" },
  { name: "Investimentos", color: "#06b6d4" },
];

const DEFAULT_EXPENSE = [
  { name: "Alimentação", color: "#f97316" },
  { name: "Moradia", color: "#8b5cf6" },
  { name: "Transporte", color: "#3b82f6" },
  { name: "Saúde", color: "#ef4444" },
  { name: "Educação", color: "#eab308" },
  { name: "Lazer", color: "#ec4899" },
  { name: "Mercado", color: "#14b8a6" },
  { name: "Assinaturas", color: "#a855f7" },
  { name: "Outros", color: "#64748b" },
];

const quickSchema = z.object({
  name: z.string().min(1, "Informe o nome").max(60),
  kind: z.enum(["income", "expense"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
  parentId: z.string().uuid().optional().or(z.literal("")),
  newParentName: z.string().max(60).optional().or(z.literal("")),
  newParentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .or(z.literal("")),
});

export type QuickCategoryState = {
  error?: string;
  success?: {
    id: string;
    name: string;
    kind: "income" | "expense";
    color: string | null;
    parentId: string | null;
  };
} | null;

export async function quickCreateCategoryAction(
  _prev: QuickCategoryState,
  formData: FormData,
): Promise<QuickCategoryState> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  const parsed = quickSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Verifique os campos." };
  }

  const { name, kind, color, parentId, newParentName, newParentColor } =
    parsed.data;

  let resolvedParentId: string | null = null;

  if (newParentName && newParentName.trim().length > 0) {
    // Cria a mãe inline
    const [parentCreated] = await db
      .insert(category)
      .values({
        organizationId: orgId,
        name: newParentName.trim(),
        kind,
        color: newParentColor || null,
      })
      .returning({ id: category.id });
    resolvedParentId = parentCreated.id;
  } else if (parentId) {
    const [parent] = await db
      .select({ id: category.id, kind: category.kind, parentId: category.parentId })
      .from(category)
      .where(
        and(eq(category.id, parentId), eq(category.organizationId, orgId)),
      )
      .limit(1);
    if (!parent) return { error: "Categoria mãe não encontrada." };
    if (parent.parentId)
      return { error: "Subcategorias podem ter apenas 1 nível." };
    if (parent.kind !== kind)
      return { error: "Tipo da subcategoria deve igualar o da mãe." };
    resolvedParentId = parent.id;
  }

  const [created] = await db
    .insert(category)
    .values({
      organizationId: orgId,
      name,
      kind,
      color: color || null,
      parentId: resolvedParentId,
    })
    .returning({
      id: category.id,
      name: category.name,
      kind: category.kind,
      color: category.color,
      parentId: category.parentId,
    });

  revalidatePath("/categorias");
  revalidatePath("/lancamentos");

  return { success: created };
}

export async function seedDefaultCategoriesAction() {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  const existing = await db
    .select({ id: category.id })
    .from(category)
    .where(eq(category.organizationId, orgId))
    .limit(1);
  if (existing.length > 0) return;

  await db.insert(category).values([
    ...DEFAULT_INCOME.map((c) => ({
      organizationId: orgId,
      name: c.name,
      kind: "income" as const,
      color: c.color,
    })),
    ...DEFAULT_EXPENSE.map((c) => ({
      organizationId: orgId,
      name: c.name,
      kind: "expense" as const,
      color: c.color,
    })),
  ]);

  revalidatePath("/categorias");
}
