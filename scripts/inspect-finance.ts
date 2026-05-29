import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { prepare: false });

  const accounts = await sql<
    Array<{
      id: string;
      name: string;
      type: string;
      owner_name: string;
      email: string;
      tx_count: string;
    }>
  >`
    SELECT fa.id::text, fa.name, fa.type, u.name AS owner_name, u.email, COUNT(t.id)::text AS tx_count
      FROM financial_account fa
      JOIN "user" u ON u.id = fa.owner_id
      LEFT JOIN transaction t ON t.account_id = fa.id
     GROUP BY fa.id, u.name, u.email
     ORDER BY u.email, fa.name;
  `;
  console.log("=== Accounts ===");
  for (const a of accounts) {
    console.log(
      `  ${a.owner_name} (${a.email}) | ${a.name} | ${a.type} | ${a.tx_count} txs | id ${a.id.slice(0, 8)}`,
    );
  }

  const cats = await sql<Array<{ id: string; name: string; kind: string }>>`
    SELECT id::text, name, kind FROM category WHERE archived = false ORDER BY kind, name;
  `;
  console.log(`\n=== Categories (${cats.length} total, non-archived) ===`);
  for (const c of cats) console.log(`  ${c.kind.padEnd(7)} ${c.name}`);

  const xfer = await sql<
    Array<{
      occurred_on: string;
      kind: string;
      amount: string;
      from_owner: string | null;
      from_acc: string | null;
      to_owner: string | null;
      to_acc: string | null;
      description: string;
    }>
  >`
    SELECT to_char(t.occurred_on, 'YYYY-MM-DD') AS occurred_on,
           t.kind, t.amount::text, t.description,
           u1.email AS from_owner, fa1.name AS from_acc,
           u2.email AS to_owner,   fa2.name AS to_acc
      FROM transaction t
 LEFT JOIN financial_account fa1 ON fa1.id = t.account_id
 LEFT JOIN "user" u1            ON u1.id = fa1.owner_id
 LEFT JOIN financial_account fa2 ON fa2.id = t.transfer_to_account_id
 LEFT JOIN "user" u2            ON u2.id = fa2.owner_id
     WHERE t.transfer_to_account_id IS NOT NULL
       AND (u1.email IS NULL OR u2.email IS NULL OR u1.email <> u2.email)
     ORDER BY t.occurred_on;
  `;
  console.log(`\n=== Cross-user transfers (${xfer.length} total) ===`);
  for (const x of xfer) {
    console.log(
      `  ${x.occurred_on} ${x.kind.padEnd(8)} ${x.amount.padStart(10)} | ${x.from_owner ?? "?"}.${x.from_acc ?? "?"} → ${x.to_owner ?? "?"}.${x.to_acc ?? "?"} | ${x.description.slice(0, 60)}`,
    );
  }

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
