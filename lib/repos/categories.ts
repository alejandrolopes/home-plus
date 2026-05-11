import "server-only";

import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { category, transaction } from "@/db/schema/finance";

export type Category = typeof category.$inferSelect;

export type CategoryNode = Category & { children: Category[] };

/**
 * Garante que a org tem ao menos uma categoria de transferência (neutra,
 * usada apenas pelo fluxo de transfer entre contas — não aparece em /categorias).
 */
async function ensureTransferCategory(orgId: string): Promise<void> {
  const [existing] = await db
    .select({ id: category.id })
    .from(category)
    .where(
      and(
        eq(category.organizationId, orgId),
        eq(category.isTransfer, true),
      ),
    )
    .limit(1);
  if (existing) return;
  await db
    .insert(category)
    .values({
      organizationId: orgId,
      name: "Transferência",
      kind: "expense",
      isTransfer: true,
      color: "#64748b",
    })
    .onConflictDoNothing();
}

export function buildCategoryTree(categories: Category[]): CategoryNode[] {
  const byId = new Map<string, CategoryNode>();
  const roots: CategoryNode[] = [];
  for (const c of categories) {
    byId.set(c.id, { ...c, children: [] });
  }
  for (const c of categories) {
    const node = byId.get(c.id)!;
    if (c.parentId && byId.has(c.parentId)) {
      byId.get(c.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export async function listCategories(
  orgId: string,
  { includeArchived = false }: { includeArchived?: boolean } = {},
) {
  await ensureTransferCategory(orgId);
  return db
    .select()
    .from(category)
    .where(
      includeArchived
        ? eq(category.organizationId, orgId)
        : and(
            eq(category.organizationId, orgId),
            eq(category.archived, false),
          ),
    )
    .orderBy(asc(category.kind), asc(category.name));
}

function normalizeDescription(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function suggestCategoriesByDescriptions(
  orgId: string,
  descriptions: string[],
): Promise<Map<string, string>> {
  const normalized = Array.from(
    new Set(
      descriptions
        .map((d) => normalizeDescription(d))
        .filter((d) => d.length > 0),
    ),
  );
  if (normalized.length === 0) return new Map();

  const rows = await db
    .select({
      norm: sql<string>`lower(translate(${transaction.description}, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))`,
      categoryId: transaction.categoryId,
      count: sql<number>`count(*)::int`,
    })
    .from(transaction)
    .where(
      and(
        eq(transaction.organizationId, orgId),
        isNotNull(transaction.categoryId),
        inArray(
          sql`lower(translate(${transaction.description}, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))`,
          normalized,
        ),
      ),
    )
    .groupBy(
      sql`lower(translate(${transaction.description}, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))`,
      transaction.categoryId,
    );

  const best = new Map<string, { categoryId: string; count: number }>();
  for (const row of rows) {
    if (!row.categoryId) continue;
    const cur = best.get(row.norm);
    if (!cur || row.count > cur.count) {
      best.set(row.norm, { categoryId: row.categoryId, count: row.count });
    }
  }

  const result = new Map<string, string>();
  for (const original of descriptions) {
    const n = normalizeDescription(original);
    const hit = best.get(n);
    if (hit) result.set(original, hit.categoryId);
  }
  return result;
}
