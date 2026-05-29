import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { prepare: false });

  const rows = await sql<
    Array<{
      account_id: string;
      card: string;
      period_start: string;
      period_end: string;
      due_date: string;
      total_amount: string;
      status: string;
      tx_count: number;
      tx_sum: string;
    }>
  >`
    SELECT ci.account_id::text,
           fa.name AS card,
           to_char(ci.period_start, 'YYYY-MM-DD') AS period_start,
           to_char(ci.period_end, 'YYYY-MM-DD') AS period_end,
           to_char(ci.due_date, 'YYYY-MM-DD') AS due_date,
           ci.total_amount::text,
           ci.status,
           COUNT(t.id)::int AS tx_count,
           COALESCE(SUM(CASE WHEN t.kind='income' THEN -t.amount ELSE t.amount END), 0)::text AS tx_sum
      FROM credit_card_invoice ci
      JOIN financial_account fa ON fa.id = ci.account_id
      LEFT JOIN transaction t ON t.credit_card_invoice_id = ci.id
     GROUP BY fa.name, ci.id
     ORDER BY fa.name, ci.account_id, ci.period_end;
  `;

  let curKey = "";
  for (const r of rows) {
    const key = `${r.card}__${r.account_id}`;
    if (key !== curKey) {
      curKey = key;
      console.log(`\n=== ${r.card} (acc ${r.account_id.slice(0, 8)}) ===`);
    }
    const totalNum = Number(r.total_amount);
    const sumNum = Number(r.tx_sum);
    const diff = (sumNum - totalNum).toFixed(2);
    const mismatch = Math.abs(sumNum - totalNum) > 0.01 ? `  ⚠ diff ${diff}` : "";
    console.log(
      `  ${r.period_start} → ${r.period_end} | venc ${r.due_date} | total ${r.total_amount.padStart(10)} | soma_tx ${r.tx_sum.padStart(10)} | ${String(r.tx_count).padStart(3)} lançs | ${r.status}${mismatch}`,
    );
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
