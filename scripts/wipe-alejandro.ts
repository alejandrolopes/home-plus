import { config } from "dotenv";
config({ path: ".env.local" });

const OWNER_EMAIL = "alejandrolopes@gmail.com";

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { prepare: false });

  await sql.begin(async (tx) => {
    const accounts = await tx<Array<{ id: string; name: string }>>`
      SELECT fa.id::text, fa.name
        FROM financial_account fa
        JOIN "user" u ON u.id = fa.owner_id
       WHERE u.email = ${OWNER_EMAIL};
    `;
    if (accounts.length === 0) {
      console.log("No accounts found for owner — nothing to wipe.");
      return;
    }
    const ids = accounts.map((a) => a.id);
    console.log(`Accounts to wipe (${accounts.length}):`);
    for (const a of accounts) console.log(`  - ${a.name} (${a.id.slice(0, 8)})`);

    const txDeleted = await tx`
      DELETE FROM transaction
       WHERE account_id IN ${tx(ids)}
       RETURNING id;
    `;
    console.log(`\nDeleted ${txDeleted.length} transactions.`);

    const invDeleted = await tx`
      DELETE FROM credit_card_invoice
       WHERE account_id IN ${tx(ids)}
       RETURNING id;
    `;
    console.log(`Deleted ${invDeleted.length} credit_card_invoice rows.`);

    const sessDeleted = await tx`
      DELETE FROM import_session
       WHERE account_id IN ${tx(ids)}
       RETURNING id;
    `;
    console.log(`Deleted ${sessDeleted.length} import_session rows.`);

    const pendDeleted = await tx`
      DELETE FROM import_pending_payment
       WHERE account_id IN ${tx(ids)}
       RETURNING id;
    `;
    console.log(`Deleted ${pendDeleted.length} import_pending_payment rows.`);

    // Cross-user transfers pointing to Alejandro's accounts: NULL the FK first
    // (the FK is set null on cascade but doing it explicitly produces a count).
    const nulled = await tx`
      UPDATE transaction
         SET transfer_to_account_id = NULL
       WHERE transfer_to_account_id IN ${tx(ids)}
       RETURNING id;
    `;
    console.log(
      `Nulled transfer_to_account_id on ${nulled.length} cross-user transactions.`,
    );

    const accDeleted = await tx`
      DELETE FROM financial_account
       WHERE id IN ${tx(ids)}
       RETURNING id;
    `;
    console.log(`Deleted ${accDeleted.length} financial_account rows.`);
  });

  await sql.end();
  console.log("\n✓ Wipe complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
