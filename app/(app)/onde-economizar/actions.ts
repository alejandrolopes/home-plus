"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { category } from "@/db/schema/finance";
import { requireOrganization } from "@/lib/guards";
import { defaultRoleFromName } from "@/lib/repos/spending-analysis";

type Result = { ok: true } | { error: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Define o role de uma categoria (3-way): "luxury" | "essential" | null.
 */
export async function setCategoryRoleAction(
  categoryId: string,
  role: "luxury" | "essential" | null,
): Promise<Result> {
  if (!UUID_RE.test(categoryId)) return { error: "ID inválido." };
  if (role !== null && role !== "luxury" && role !== "essential") {
    return { error: "Role inválido." };
  }
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  await db
    .update(category)
    .set({ role })
    .where(
      and(eq(category.id, categoryId), eq(category.organizationId, orgId)),
    );

  revalidatePath("/onde-economizar");
  revalidatePath("/categorias");
  return { ok: true };
}

/**
 * Aplica classificação automática apenas quando NENHUMA categoria da org tem
 * role definido. Chamado pela página /onde-economizar no primeiro acesso.
 * Idempotente: se já há classificação, não toca em nada.
 */
export async function autoClassifyIfFirstAccess(): Promise<void> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  // Só roda quando nenhuma categoria foi classificada ainda
  const cats = await db
    .select({ id: category.id, name: category.name, role: category.role })
    .from(category)
    .where(
      and(
        eq(category.organizationId, orgId),
        eq(category.archived, false),
      ),
    );
  if (cats.some((c) => c.role !== null)) return;

  const updates: Array<{ id: string; role: "luxury" | "essential" }> = [];
  for (const c of cats) {
    const r = defaultRoleFromName(c.name);
    if (r) updates.push({ id: c.id, role: r });
  }
  if (updates.length === 0) return;

  await db.transaction(async (tx) => {
    for (const u of updates) {
      await tx
        .update(category)
        .set({ role: u.role })
        .where(
          and(
            eq(category.id, u.id),
            eq(category.organizationId, orgId),
            isNull(category.role),
          ),
        );
    }
  });
  // Não chama revalidatePath: esta função roda DURANTE o render de
  // /onde-economizar, e o Next.js 16 proíbe revalidatePath em render.
  // A mesma request lê o estado atualizado nas próximas queries.
}

const bulkSchema = z.array(
  z.object({
    categoryId: z.string().uuid(),
    role: z.union([
      z.literal("luxury"),
      z.literal("essential"),
      z.null(),
    ]),
  }),
);

/** Atualiza várias categorias de uma vez (usado pelo config dialog). */
export async function bulkSetCategoryRolesAction(
  updates: Array<{
    categoryId: string;
    role: "luxury" | "essential" | null;
  }>,
): Promise<Result> {
  const parsed = bulkSchema.safeParse(updates);
  if (!parsed.success) return { error: "Dados inválidos." };
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  await db.transaction(async (tx) => {
    for (const u of parsed.data) {
      await tx
        .update(category)
        .set({ role: u.role })
        .where(
          and(
            eq(category.id, u.categoryId),
            eq(category.organizationId, orgId),
          ),
        );
    }
  });
  revalidatePath("/onde-economizar");
  revalidatePath("/categorias");
  return { ok: true };
}
