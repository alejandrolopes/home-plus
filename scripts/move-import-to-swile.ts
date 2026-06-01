import postgres from "postgres";

const ALEJANDRO_ID = "d80riKY65C1FjNTNVc88IEMHrSKlRAyX";
const NU_CONTA_ID = "4f9a8ebf-f0d8-46d7-aaed-80a9614a06d5";
const SWILE_MOB_ID = "c8a082fa-ab88-46bf-ad54-7312c39e31b3";

async function main() {
  const prod = postgres(process.env.PROD_DB!, { prepare: false });
  const dryRun = process.env.DRY_RUN === "1";
  if (dryRun) console.log("[DRY RUN]\n");

  try {
    await prod.begin(async (tx) => {
      // Find 57 transactions: NU Conta, owner=Alejandro, created in last 6h
      const targets = await tx.unsafe<{ id: string }[]>(
        `SELECT id FROM "transaction"
         WHERE account_id = $1
           AND owner_id = $2
           AND created_at > NOW() - INTERVAL '6 hours'`,
        [NU_CONTA_ID, ALEJANDRO_ID],
      );
      console.log(`Found ${targets.length} transactions to move (NU Conta → Swile Mobilidade)`);

      // Also check import_sessions touched by these transactions
      const sessions = await tx.unsafe<{ id: string; account_id: string; count: number }[]>(
        `SELECT s.id, s.account_id, COUNT(t.id)::int as count
         FROM "import_session" s
         JOIN "transaction" t ON t.import_session_id = s.id
         WHERE t.id = ANY($1::uuid[])
         GROUP BY s.id, s.account_id`,
        [targets.map((r) => r.id)],
      );
      console.log(`\nImport sessions involved:`);
      for (const s of sessions) {
        console.log(`  session=${s.id.slice(0,8)} current_account=${s.account_id.slice(0,8)} tx_count=${s.count}`);
      }

      if (!dryRun) {
        // Move transactions
        const updated = await tx.unsafe<{ id: string }[]>(
          `UPDATE "transaction"
           SET account_id = $1, updated_at = NOW()
           WHERE id = ANY($2::uuid[])
           RETURNING id`,
          [SWILE_MOB_ID, targets.map((r) => r.id)],
        );
        console.log(`\nUpdated ${updated.length} transactions: account_id → Swile Mobilidade`);

        // Move import_sessions too, if they only contain moved transactions
        for (const s of sessions) {
          const remaining = await tx.unsafe<{ c: number }[]>(
            `SELECT COUNT(*)::int as c FROM "transaction"
             WHERE import_session_id = $1 AND account_id != $2`,
            [s.id, SWILE_MOB_ID],
          );
          if (remaining[0].c === 0) {
            await tx.unsafe(
              `UPDATE "import_session" SET account_id = $1 WHERE id = $2`,
              [SWILE_MOB_ID, s.id],
            );
            console.log(`  Moved import_session ${s.id.slice(0,8)} → Swile Mobilidade`);
          } else {
            console.log(`  Import_session ${s.id.slice(0,8)} kept on NU Conta (${remaining[0].c} other tx still there)`);
          }
        }
      } else {
        console.log("\n(DRY_RUN: no UPDATE performed)");
        throw new Error("__DRY_RUN_ROLLBACK__");
      }
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg !== "__DRY_RUN_ROLLBACK__") {
      console.error("FAILED, transaction rolled back:", msg);
      process.exit(1);
    }
  } finally {
    await prod.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
