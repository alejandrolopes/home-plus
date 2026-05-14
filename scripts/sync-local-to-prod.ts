import { existsSync } from "node:fs";

const TABLE_ORDER = [
  "user",
  "verification",
  "organization",
  "member",
  "invitation",
  "account",
  "session",
  "financial_account",
  "category",
  "organization_finance_settings",
  "user_finance_settings",
  "credit_card_invoice",
  "import_session",
  "import_pending_payment",
  "transaction",
] as const;

async function main() {
  if (!process.env.LOCAL_DB || !process.env.PROD_DB) {
    console.error("usage: LOCAL_DB=... PROD_DB=... tsx scripts/sync-local-to-prod.ts");
    process.exit(1);
  }

  const { default: postgres } = await import("postgres");
  const local = postgres(process.env.LOCAL_DB, { prepare: false });
  const prod = postgres(process.env.PROD_DB, { prepare: false });

  async function getPk(client: ReturnType<typeof postgres>, table: string): Promise<string[]> {
    const rows = await client.unsafe<{ column_name: string }[]>(
      `
        SELECT a.attname AS column_name
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = $1::regclass AND i.indisprimary
        ORDER BY array_position(i.indkey, a.attnum)
      `,
      [`"${table}"`],
    );
    return rows.map((r) => r.column_name);
  }

  async function getSelfFkColumn(
    client: ReturnType<typeof postgres>,
    table: string,
  ): Promise<string | null> {
    const rows = await client.unsafe<{ column_name: string }[]>(
      `
        SELECT kcu.column_name
        FROM information_schema.referential_constraints rc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = rc.constraint_name
         AND kcu.table_schema = rc.constraint_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = rc.unique_constraint_name
         AND ccu.table_schema = rc.unique_constraint_schema
        WHERE kcu.table_schema = 'public'
          AND kcu.table_name = $1
          AND ccu.table_name = $1
        LIMIT 1
      `,
      [table],
    );
    return rows[0]?.column_name ?? null;
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

  async function getColumns(client: ReturnType<typeof postgres>, table: string): Promise<string[]> {
    const rows = await client.unsafe<{ column_name: string }[]>(
      `
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `,
      [table],
    );
    return rows.map((r) => r.column_name);
  }

  const dryRun = process.env.DRY_RUN === "1";
  if (dryRun) console.log("[DRY RUN] no writes will be performed\n");

  const summary: { table: string; inserted: number; skipped: number }[] = [];

  try {
    await prod.begin(async (tx) => {
      for (const table of TABLE_ORDER) {
        const cols = await getColumns(local, table);
        if (cols.length === 0) {
          console.log(`- ${table}: table missing locally, skip`);
          continue;
        }
        const pk = await getPk(local, table);
        const selfFk = await getSelfFkColumn(local, table);
        let rows: Record<string, unknown>[] = [
          ...(await local.unsafe<Record<string, unknown>[]>(
            `SELECT ${cols.map((c) => `"${c}"`).join(", ")} FROM "${table}"`,
          )),
        ];
        if (selfFk && pk.length === 1) {
          rows = topoSort(rows, pk[0], selfFk);
        }
        if (rows.length === 0) {
          console.log(`- ${table}: 0 rows in local, skip`);
          summary.push({ table, inserted: 0, skipped: 0 });
          continue;
        }
        let inserted = 0;
        if (dryRun) {
          if (pk.length > 0) {
            const pkCols = pk.map((c) => `"${c}"`).join(", ");
            const localKeys = rows.map((r) => pk.map((c) => r[c]));
            const existing = await prod.unsafe<Record<string, unknown>[]>(
              `SELECT ${pkCols} FROM "${table}"`,
            );
            const existSet = new Set(
              existing.map((r) => pk.map((c) => String(r[c])).join("|")),
            );
            for (const k of localKeys) {
              const key = k.map((v) => String(v)).join("|");
              if (!existSet.has(key)) inserted++;
            }
          } else {
            inserted = rows.length;
          }
        } else {
          for (const row of rows) {
            const values = cols.map((c) => row[c]);
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
            const conflict =
              pk.length > 0
                ? `ON CONFLICT (${pk.map((c) => `"${c}"`).join(", ")}) DO NOTHING`
                : "";
            const sqlStr = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders}) ${conflict} RETURNING 1`;
            const r = await tx.unsafe<unknown[]>(sqlStr, values);
            if (r.length > 0) inserted++;
          }
        }
        const skipped = rows.length - inserted;
        console.log(`+ ${table}: ${inserted} would insert, ${skipped} skip (conflict)`);
        summary.push({ table, inserted, skipped });
      }
      if (dryRun) throw new Error("__DRY_RUN_ROLLBACK__");
    });

    console.log("\n=== SUMMARY ===");
    for (const s of summary) {
      console.log(`${s.table.padEnd(34)} inserted=${s.inserted}\tskipped=${s.skipped}`);
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "__DRY_RUN_ROLLBACK__") {
      console.log("\n=== DRY-RUN SUMMARY (no writes applied) ===");
      for (const s of summary) {
        console.log(`${s.table.padEnd(34)} would_insert=${s.inserted}\tskip=${s.skipped}`);
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
