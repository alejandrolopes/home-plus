import "dotenv/config";

process.loadEnvFile?.(".env.local");

import { eq } from "drizzle-orm";
import { db } from "../db";
import { transaction } from "../db/schema/finance";
import { parseDescription } from "../lib/import/description-parser";

async function main() {
  const orgId = process.argv[2];
  if (!orgId) {
    console.error("usage: tsx scripts/reparse-descriptions.ts <orgId>");
    process.exit(1);
  }

  const rows = await db
    .select({ id: transaction.id, description: transaction.description })
    .from(transaction)
    .where(eq(transaction.organizationId, orgId));

  let updated = 0;
  let skipped = 0;
  for (const r of rows) {
    if (!r.description) {
      skipped++;
      continue;
    }
    const parsed = parseDescription(r.description);
    await db
      .update(transaction)
      .set({
        cleanDescription: parsed.cleanDescription,
        paymentMethod: parsed.paymentMethod,
        counterpartyName: parsed.counterpartyName,
        counterpartyDocument: parsed.counterpartyDocument,
        counterpartyBank: parsed.counterpartyBank,
        counterpartyBranch: parsed.counterpartyBranch,
        counterpartyAccount: parsed.counterpartyAccount,
      })
      .where(eq(transaction.id, r.id));
    updated++;
  }

  console.log(`updated=${updated} skipped=${skipped}`);
  process.exit(0);
}

main();
