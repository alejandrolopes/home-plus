import postgres from "postgres";

const ORG_ID = "mrglDZo6tmTYxtK6aAS6Ht7wxKVMsZsK"; // Carvalho Ninahuaman

// Ordem reversa de FK pra DELETE; direta pra INSERT.
const TABLES = [
  "category",
  "financial_account",
  "credit_card_invoice",
  "transaction",
  "import_session",
  "import_pending_payment",
  "organization_finance_settings",
  "user_finance_settings",
];

// Tabelas com self-FK (precisam topo sort no INSERT).
const SELF_FK: Record<string, string> = {
  category: "parent_id",
  transaction: "parent_transaction_id",
};

async function getColumns(
  client: ReturnType<typeof postgres>,
  table: string,
): Promise<string[]> {
  const rows = await client.unsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((r) => r.column_name);
}

function topoSort(
  rows: Record<string, unknown>[],
  pkCol: string,
  selfFkCol: string,
): Record<string, unknown>[] {
  const byId = new Map(rows.map((r) => [String(r[pkCol]), r]));
  const placed = new Set<string>();
  const ordered: Record<string, unknown>[] = [];
  function visit(row: Record<string, unknown>, stack: Set<string>) {
    const id = String(row[pkCol]);
    if (placed.has(id) || stack.has(id)) return;
    stack.add(id);
    const parent = row[selfFkCol];
    if (parent != null && byId.has(String(parent))) {
      visit(byId.get(String(parent))!, stack);
    }
    stack.delete(id);
    placed.add(id);
    ordered.push(row);
  }
  for (const r of rows) visit(r, new Set());
  return ordered;
}

async function main() {
  const localUrl = process.env.LOCAL_DB;
  const prodUrl = process.env.PROD_DB;
  const dryRun = process.env.DRY_RUN === "1";
  if (!localUrl || !prodUrl) {
    console.error("usage: LOCAL_DB=... PROD_DB=... [DRY_RUN=1] tsx scripts/replace-org.ts");
    process.exit(1);
  }
  if (dryRun) console.log("[DRY RUN] no writes\n");

  const local = postgres(localUrl, { prepare: false });
  const prod = postgres(prodUrl, { prepare: false });

  type Step = { table: string; deleted: number; inserted: number };
  const summary: Step[] = [];

  try {
    await prod.begin(async (tx) => {
      // 1) DELETE in reverse FK order, scoped to org.
      const deleteOrder = [...TABLES].reverse();
      for (const table of deleteOrder) {
        const before = (
          await tx.unsafe<{ c: number }[]>(
            `SELECT COUNT(*)::int as c FROM "${table}" WHERE organization_id = $1`,
            [ORG_ID],
          )
        )[0].c;
        let deleted = 0;
        if (!dryRun && before > 0) {
          const result = await tx.unsafe<{ id: string }[]>(
            `DELETE FROM "${table}" WHERE organization_id = $1 RETURNING 1`,
            [ORG_ID],
          );
          deleted = result.length;
        } else {
          deleted = before;
        }
        console.log(`DEL  ${table.padEnd(34)} ${dryRun ? "would_delete" : "deleted"}=${deleted}`);
      }

      // 2) INSERT in FK order.
      for (const table of TABLES) {
        const cols = await getColumns(local, table);
        if (cols.length === 0) {
          console.log(`INS  ${table.padEnd(34)} table missing locally, skip`);
          summary.push({ table, deleted: 0, inserted: 0 });
          continue;
        }
        let rows = await local.unsafe<Record<string, unknown>[]>(
          `SELECT ${cols.map((c) => `"${c}"`).join(", ")} FROM "${table}" WHERE organization_id = $1`,
          [ORG_ID],
        );
        const selfFk = SELF_FK[table];
        if (selfFk && rows.length > 0) {
          rows = topoSort(rows, "id", selfFk);
        }
        let inserted = 0;
        if (!dryRun && rows.length > 0) {
          for (const row of rows) {
            const values = cols.map((c) => row[c]);
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
            const sqlStr = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`;
            await tx.unsafe(sqlStr, values);
            inserted++;
          }
        } else {
          inserted = rows.length;
        }
        console.log(`INS  ${table.padEnd(34)} ${dryRun ? "would_insert" : "inserted"}=${inserted}`);
        summary.push({ table, deleted: 0, inserted });
      }

      if (dryRun) throw new Error("__DRY_RUN_ROLLBACK__");
    });

    console.log("\n=== SUMMARY ===");
    for (const s of summary) {
      console.log(`${s.table.padEnd(34)} inserted=${s.inserted}`);
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "__DRY_RUN_ROLLBACK__") {
      console.log("\n=== DRY-RUN SUMMARY (no writes applied) ===");
      for (const s of summary) {
        console.log(`${s.table.padEnd(34)} would_insert=${s.inserted}`);
      }
    } else {
      console.error("FAILED, transaction rolled back:", msg);
      process.exit(1);
    }
  } finally {
    await local.end();
    await prod.end();
  }
}

main();
