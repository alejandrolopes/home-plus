import postgres from "postgres";

const NU_CONTA_CORRENTE_ID = "b6c1bd06-b5b5-4140-99ed-16eef7ebafe5";

async function main() {
  const prod = postgres(process.env.PROD_DB!, { prepare: false });

  const swile = await prod.unsafe<{ id: string; name: string; owner_id: string }[]>(
    `SELECT id, name, owner_id FROM "financial_account" WHERE name ILIKE $1 ORDER BY created_at DESC`,
    ["%Swile Mobilidade%"],
  );
  console.log("Swile Mobilidade accounts:");
  for (const a of swile) console.log(`  ${a.id} owner=${a.owner_id.slice(0,8)} name="${a.name}"`);

  const sessions = await prod.unsafe<{
    id: string;
    account_id: string;
    created_at: Date;
    filename: string | null;
    transaction_count: number;
  }[]>(
    `
      SELECT s.id, s.account_id, s.created_at, s.filename,
        (SELECT COUNT(*)::int FROM "transaction" t WHERE t.import_session_id = s.id) as transaction_count
      FROM "import_session" s
      WHERE s.account_id = $1
      ORDER BY s.created_at DESC
      LIMIT 5
    `,
    [NU_CONTA_CORRENTE_ID],
  );
  console.log(`\nRecent import_sessions for NU Conta Corrente:`);
  for (const s of sessions) {
    console.log(`  ${s.id} ${s.created_at.toISOString()} txs=${s.transaction_count} file="${s.filename ?? "-"}"`);
  }

  // Most recent — show sample transactions
  if (sessions.length > 0) {
    const latest = sessions[0];
    console.log(`\nFirst 5 transactions of session ${latest.id}:`);
    const sample = await prod.unsafe<{
      id: string;
      occurred_on: string;
      description: string;
      amount: string;
      kind: string;
    }[]>(
      `SELECT id, occurred_on, description, amount, kind
       FROM "transaction" WHERE import_session_id = $1
       ORDER BY occurred_on LIMIT 5`,
      [latest.id],
    );
    for (const t of sample) {
      console.log(`  ${t.occurred_on} ${t.kind.padEnd(8)} ${t.amount.padStart(10)} ${t.description}`);
    }
  }

  await prod.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
