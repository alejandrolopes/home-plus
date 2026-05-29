import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { prepare: false });

  // Categorias reembolsáveis (todas as orgs)
  const cats = await sql<
    Array<{ id: string; org: string; name: string }>
  >`
    SELECT id::text, organization_id::text AS org, name
      FROM category
     WHERE is_reimbursable = true AND archived = false
  `;
  console.log(`Categorias reembolsáveis: ${cats.length}`);

  let totalCreated = 0;
  for (const cat of cats) {
    // Expense txs nessa categoria que ainda NÃO têm reimbursement
    const missing = await sql<
      Array<{ id: string; description: string; amount: string }>
    >`
      SELECT t.id::text, t.description, t.amount::text
        FROM transaction t
       WHERE t.organization_id = ${cat.org}
         AND t.category_id = ${cat.id}
         AND t.kind = 'expense'
         AND NOT EXISTS (
           SELECT 1 FROM reimbursement r WHERE r.expense_tx_id = t.id
         )
    `;
    if (missing.length === 0) {
      console.log(`  ${cat.name}: já em dia`);
      continue;
    }
    await sql`
      INSERT INTO reimbursement (organization_id, expense_tx_id, expected_from)
      VALUES ${sql(
        missing.map((m) => [cat.org, m.id, cat.name]),
      )}
      ON CONFLICT (expense_tx_id) DO NOTHING
    `;
    console.log(`  ${cat.name}: +${missing.length} pendings`);
    totalCreated += missing.length;
  }

  console.log(`\n✓ Total: ${totalCreated} reimbursements pending criados.`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
