import { config } from "dotenv";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
config({ path: ".env.local" });

const TABLES = [
  "financial_account",
  "category",
  "credit_card_invoice",
  "transaction",
  "import_session",
  "import_pending_payment",
  "reimbursement",
  "organization_finance_settings",
  "user_finance_settings",
];

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { prepare: false });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join("backups", `finance-${ts}`);
  mkdirSync(dir, { recursive: true });

  const summary: Record<string, number> = {};
  for (const t of TABLES) {
    const rows = await sql.unsafe(`SELECT * FROM "${t}"`);
    writeFileSync(
      join(dir, `${t}.json`),
      JSON.stringify(rows, null, 2),
      "utf8",
    );
    summary[t] = rows.length;
    console.log(`  ${t}: ${rows.length} rows`);
  }
  writeFileSync(
    join(dir, "summary.json"),
    JSON.stringify({ ts, summary }, null, 2),
    "utf8",
  );
  console.log(`\n✓ Backup written to ${dir}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
