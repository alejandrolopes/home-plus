import postgres from "postgres";

const NU_CONTA_CORRENTE_ID = "b6c1bd06-b5b5-4140-99ed-16eef7ebafe5";

async function main() {
  const prod = postgres(process.env.PROD_DB!, { prepare: false });

  // Recent transactions in NU Conta Corrente (last hour)
  const recent = await prod.unsafe<{
    id: string;
    occurred_on: string;
    description: string;
    amount: string;
    kind: string;
    created_at: Date;
    import_session_id: string | null;
    external_id: string | null;
  }[]>(
    `SELECT id, occurred_on, description, amount, kind, created_at, import_session_id, external_id
     FROM "transaction"
     WHERE account_id = $1
       AND created_at > NOW() - INTERVAL '2 hours'
     ORDER BY created_at DESC`,
    [NU_CONTA_CORRENTE_ID],
  );
  console.log(`Transactions in NU Conta Corrente (b6c1bd06) created in last 2h: ${recent.length}`);
  for (const t of recent.slice(0, 5)) {
    console.log(`  ${t.occurred_on} ${t.kind.padEnd(8)} ${t.amount.padStart(10)} ${t.description} (sess=${t.import_session_id?.slice(0,8) ?? "null"})`);
  }
  if (recent.length > 5) console.log(`  ... (+${recent.length - 5} more)`);

  // Also count by import_session_id (NULL vs not)
  const grouped = await prod.unsafe<{ import_session_id: string | null; count: number }[]>(
    `SELECT import_session_id, COUNT(*)::int as count
     FROM "transaction"
     WHERE account_id = $1
       AND created_at > NOW() - INTERVAL '2 hours'
     GROUP BY import_session_id`,
    [NU_CONTA_CORRENTE_ID],
  );
  console.log("\nGrouped by import_session_id:");
  for (const r of grouped) {
    console.log(`  session=${r.import_session_id?.slice(0,8) ?? "null"} count=${r.count}`);
  }

  await prod.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
