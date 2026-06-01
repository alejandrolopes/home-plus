import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

// Tabelas em ordem reversa de FK (deletar dependentes primeiro).
const TABLES = [
  "import_pending_payment",
  "import_session",
  "transaction",
  "credit_card_invoice",
  "category",
  "financial_account",
];

async function main() {
  const backupDir = process.env.BACKUP_DIR;
  const url = process.env.PROD_DB;
  const dryRun = process.env.DRY_RUN === "1";
  if (!backupDir || !url) {
    console.error("usage: BACKUP_DIR=backups/finance-... PROD_DB=... [DRY_RUN=1] tsx scripts/rollback-from-backup.ts");
    process.exit(1);
  }
  if (dryRun) console.log("[DRY RUN] no deletes will be performed\n");

  const sql = postgres(url, { prepare: false });
  const summary: { table: string; toDelete: number; deleted: number }[] = [];

  try {
    await sql.begin(async (tx) => {
      for (const table of TABLES) {
        const file = join(backupDir, `${table}.json`);
        const rows: Array<{ id: string }> = JSON.parse(
          readFileSync(file, "utf8"),
        );
        const backupIds = new Set(rows.map((r) => r.id));
        const prodRows = await tx.unsafe<{ id: string }[]>(
          `SELECT id FROM "${table}"`,
        );
        const toDelete = prodRows.filter((r) => !backupIds.has(r.id));
        let deleted = 0;
        if (!dryRun && toDelete.length > 0) {
          const ids = toDelete.map((r) => r.id);
          const result = await tx.unsafe<{ id: string }[]>(
            `DELETE FROM "${table}" WHERE id = ANY($1::uuid[]) RETURNING id`,
            [ids],
          );
          deleted = result.length;
        }
        console.log(`- ${table}: backup=${backupIds.size}, prod=${prodRows.length}, ${dryRun ? "would_delete" : "deleted"}=${toDelete.length}${deleted ? ` (executed ${deleted})` : ""}`);
        summary.push({ table, toDelete: toDelete.length, deleted });
      }
      if (dryRun) throw new Error("__DRY_RUN_ROLLBACK__");
    });
    console.log("\n=== SUMMARY ===");
    for (const s of summary) {
      console.log(`${s.table.padEnd(28)} ${dryRun ? "would_delete" : "deleted"}=${s.toDelete}`);
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "__DRY_RUN_ROLLBACK__") {
      console.log("\n=== DRY-RUN SUMMARY (no deletes applied) ===");
      for (const s of summary) {
        console.log(`${s.table.padEnd(28)} would_delete=${s.toDelete}`);
      }
    } else {
      console.error("FAILED, transaction rolled back:", msg);
      process.exit(1);
    }
  } finally {
    await sql.end();
  }
}

main();
