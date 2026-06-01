import postgres from "postgres";

const ALEJANDRO_ID = "d80riKY65C1FjNTNVc88IEMHrSKlRAyX";

async function main() {
  const prod = postgres(process.env.PROD_DB!, { prepare: false });

  // All Alejandro's accounts
  const accounts = await prod.unsafe<{ id: string; name: string; type: string; created_at: Date }[]>(
    `SELECT id, name, type, created_at FROM "financial_account" WHERE owner_id = $1 ORDER BY created_at DESC`,
    [ALEJANDRO_ID],
  );
  console.log(`Alejandro's accounts (${accounts.length}):`);
  for (const a of accounts) {
    console.log(`  ${a.created_at.toISOString()} ${a.type.padEnd(13)} ${a.id} "${a.name}"`);
  }

  // Recent transactions across ALL Alejandro's accounts
  console.log(`\nRecent transactions (last 6h) across Alejandro's accounts, grouped by account:`);
  const grouped = await prod.unsafe<{ account_id: string; account_name: string; count: number }[]>(
    `SELECT t.account_id, fa.name as account_name, COUNT(*)::int as count
     FROM "transaction" t
     JOIN "financial_account" fa ON fa.id = t.account_id
     WHERE t.owner_id = $1 AND t.created_at > NOW() - INTERVAL '6 hours'
     GROUP BY t.account_id, fa.name
     ORDER BY count DESC`,
    [ALEJANDRO_ID],
  );
  for (const r of grouped) {
    console.log(`  account=${r.account_id} name="${r.account_name}" count=${r.count}`);
  }

  await prod.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
