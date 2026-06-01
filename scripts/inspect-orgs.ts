import postgres from "postgres";

async function inspect(label: string, url: string) {
  console.log(`\n=== ${label} ===`);
  const sql = postgres(url, { prepare: false });
  try {
    const orgs = await sql.unsafe<{ id: string; name: string }[]>(
      `SELECT id, name FROM "organization" ORDER BY name`,
    );
    for (const o of orgs) {
      const [memberCount] = await sql.unsafe<{ c: number }[]>(
        `SELECT COUNT(*)::int as c FROM "member" WHERE organization_id = $1`,
        [o.id],
      );
      const [accCount] = await sql.unsafe<{ c: number }[]>(
        `SELECT COUNT(*)::int as c FROM "financial_account" WHERE organization_id = $1`,
        [o.id],
      );
      const [txCount] = await sql.unsafe<{ c: number }[]>(
        `SELECT COUNT(*)::int as c FROM "transaction" WHERE organization_id = $1`,
        [o.id],
      );
      const [catCount] = await sql.unsafe<{ c: number }[]>(
        `SELECT COUNT(*)::int as c FROM "category" WHERE organization_id = $1`,
        [o.id],
      );
      console.log(`${o.name.padEnd(35)} ${o.id}`);
      console.log(`  members=${memberCount.c} accounts=${accCount.c} categories=${catCount.c} transactions=${txCount.c}`);
      const members = await sql.unsafe<{ user_id: string; role: string; email: string; name: string }[]>(
        `SELECT m.user_id, m.role, u.email, u.name
         FROM "member" m JOIN "user" u ON u.id = m.user_id
         WHERE m.organization_id = $1`,
        [o.id],
      );
      for (const m of members) {
        console.log(`  - ${m.role.padEnd(7)} ${m.email.padEnd(30)} ${m.name} (${m.user_id.slice(0, 8)})`);
      }
    }
  } finally {
    await sql.end();
  }
}

async function main() {
  await inspect("LOCAL", process.env.LOCAL_DB!);
  await inspect("PROD", process.env.PROD_DB!);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
