"use server";

import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { financialAccount, transaction } from "@/db/schema/finance";
import { requireOrganization } from "@/lib/guards";
import {
  parseHolerite,
  type ParsedHolerite,
} from "@/lib/import/holerite-parser";
import { suggestCategoriesByDescriptions } from "@/lib/repos/categories";

export type HoleriteCandidate = {
  id: string;
  description: string;
  occurredOn: string;
  amount: string;
  accountName: string;
  hasSplits: boolean;
};

export type HoleriteResult = {
  filename: string;
  parsed: ParsedHolerite | null;
  candidates: HoleriteCandidate[];
  /** Map<description, categoryId> sugerido a partir do histórico de splits/lançamentos */
  suggestedCategories: Record<string, string>;
  error: string | null;
};

export async function parseHoleritesAction(
  formData: FormData,
): Promise<{ results: HoleriteResult[] }> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  const files = formData.getAll("file");
  const results: HoleriteResult[] = [];

  for (const f of files) {
    if (!(f instanceof File)) continue;
    const filename = f.name;
    try {
      const buffer = Buffer.from(await f.arrayBuffer());
      const parsed = await parseHolerite(buffer);

      // Find candidates: income transactions with same amount, no splits, within ±60 days
      const candidatesRows = await db
        .select({
          id: transaction.id,
          description: transaction.description,
          cleanDescription: transaction.cleanDescription,
          occurredOn: transaction.occurredOn,
          amount: transaction.amount,
          accountName: financialAccount.name,
        })
        .from(transaction)
        .leftJoin(
          financialAccount,
          eq(transaction.accountId, financialAccount.id),
        )
        .where(
          and(
            eq(transaction.organizationId, orgId),
            eq(transaction.kind, "income"),
            eq(transaction.amount, parsed.liquido),
            isNull(transaction.parentTransactionId),
            or(
              isNull(transaction.installmentNumber),
              eq(transaction.installmentNumber, 0),
            )!,
          ),
        )
        .orderBy(transaction.occurredOn);

      const candidates: HoleriteCandidate[] = candidatesRows.map((r) => ({
        id: r.id,
        description: r.cleanDescription ?? r.description,
        occurredOn: r.occurredOn,
        amount: r.amount,
        accountName: r.accountName ?? "—",
        hasSplits: false,
      }));

      const descriptions = parsed.lines.map((l) => l.description);
      const suggestionMap = await suggestCategoriesByDescriptions(
        orgId,
        descriptions,
      );
      const suggestedCategories: Record<string, string> = {};
      for (const [desc, catId] of suggestionMap) {
        suggestedCategories[desc] = catId;
      }

      results.push({
        filename,
        parsed,
        candidates,
        suggestedCategories,
        error: null,
      });
    } catch (e) {
      results.push({
        filename,
        parsed: null,
        candidates: [],
        suggestedCategories: {},
        error:
          e instanceof Error ? e.message : "Falha ao processar arquivo.",
      });
    }
  }

  return { results };
}
