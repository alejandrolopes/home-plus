import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { prepare: false });

  const counts = await sql<
    Array<{ table: string; n: string }>
  >`
    SELECT 'financial_account' AS table, COUNT(*)::text AS n FROM financial_account
    UNION ALL
    SELECT 'transaction',        COUNT(*)::text FROM transaction
    UNION ALL
    SELECT 'credit_card_invoice',COUNT(*)::text FROM credit_card_invoice
    UNION ALL
    SELECT 'import_session',     COUNT(*)::text FROM import_session
    UNION ALL
    SELECT 'import_pending_payment', COUNT(*)::text FROM import_pending_payment
    UNION ALL
    SELECT 'category',           COUNT(*)::text FROM category
    UNION ALL
    SELECT 'categorization_rule',COUNT(*)::text FROM categorization_rule
    UNION ALL
    SELECT 'reimbursement',      COUNT(*)::text FROM reimbursement;
  `;
  console.log("=== Row counts ===");
  for (const c of counts) console.log(`  ${c.table.padEnd(25)} ${c.n}`);

  // Orphans: any transaction whose accountId still points to a now-deleted account?
  const orphans = await sql<Array<{ n: string }>>`
    SELECT COUNT(*)::text AS n
      FROM transaction t
     WHERE t.account_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM financial_account fa WHERE fa.id = t.account_id
       );
  `;
  console.log(`\nOrphan transactions (bad account_id): ${orphans[0].n}`);

  // Transactions whose transfer_to_account_id is null but were originally cross-user
  const nulledXfer = await sql<Array<{ n: string }>>`
    SELECT COUNT(*)::text AS n
      FROM transaction
     WHERE kind = 'transfer' AND transfer_to_account_id IS NULL;
  `;
  console.log(`Transactions with kind=transfer and NULL transfer_to_account_id: ${nulledXfer[0].n}`);

  // Alejandro user still exists?
  const ale = await sql<
    Array<{ id: string; email: string }>
  >`SELECT id, email FROM "user" WHERE email = 'alejandrolopes@gmail.com';`;
  console.log(`\nAlejandro user row: ${ale.length === 1 ? "present" : "MISSING"}`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
