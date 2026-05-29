import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { prepare: false });

  // Sessão mais recente do reimport: Nubank_2026-03-04.ofx
  const [sess] = await sql<Array<{ id: string }>>`
    SELECT id::text FROM import_session
     WHERE filename = 'Nubank_2026-03-04.ofx'
     ORDER BY created_at DESC LIMIT 1
  `;
  if (!sess) {
    console.log("Sessão não encontrada.");
    await sql.end();
    return;
  }
  console.log(`Sessão alvo: ${sess.id}`);

  // Fatura correta de mar (venc 04/03)
  const [marInv] = await sql<Array<{ id: string }>>`
    SELECT id::text FROM credit_card_invoice
     WHERE due_date = '2026-03-04'
       AND account_id IN (
         SELECT id FROM financial_account
          WHERE owner_id = (SELECT id FROM "user" WHERE email='alejandrolopes@gmail.com')
       )
     LIMIT 1
  `;
  if (!marInv) {
    console.log("Fatura mar não encontrada.");
    await sql.end();
    return;
  }
  console.log(`Fatura mar alvo: ${marInv.id}`);

  // Identifica todas as txs dessa sessão e a fatura onde estão atualmente
  const txs = await sql<
    Array<{ id: string; cci: string | null }>
  >`
    SELECT id::text, credit_card_invoice_id::text AS cci
      FROM transaction
     WHERE import_session_id = ${sess.id}
  `;
  console.log(`Lançamentos da sessão: ${txs.length}`);

  const wrongInvoiceIds = new Set<string>();
  for (const t of txs) {
    if (t.cci && t.cci !== marInv.id) wrongInvoiceIds.add(t.cci);
  }
  console.log(`Faturas erradas detectadas: ${[...wrongInvoiceIds].map(i=>i.slice(0,8)).join(", ") || "(nenhuma)"}`);

  const wrongTxs = txs.filter((t) => t.cci && t.cci !== marInv.id);
  if (wrongTxs.length === 0) {
    console.log("Nada a mover. Saindo.");
    await sql.end();
    return;
  }
  console.log(`Vou mover ${wrongTxs.length} lançamentos pra a fatura mar (${marInv.id.slice(0,8)}).`);

  await sql.begin(async (tx) => {
    await tx`
      UPDATE transaction
         SET credit_card_invoice_id = ${marInv.id}
       WHERE id IN ${tx(wrongTxs.map((t) => t.id))}
    `;
  });
  console.log(`Movidos.`);

  // Recompute (mesma fórmula do helper, mas inline aqui)
  const recompute = async (invId: string) => {
    const [g] = await sql<Array<{ total: string }>>`
      SELECT COALESCE(SUM(CASE WHEN kind='expense' THEN amount ELSE -amount END)::numeric, 0)::text AS total
        FROM transaction WHERE credit_card_invoice_id = ${invId}
    `;
    const [p] = await sql<Array<{ total: string }>>`
      SELECT COALESCE(SUM(amount)::numeric, 0)::text AS total
        FROM transaction WHERE paid_invoice_id = ${invId} AND kind = 'expense'
    `;
    const total = Number(g.total).toFixed(2);
    const paid = Number(p.total).toFixed(2);
    const totalC = Math.round(Number(total) * 100);
    const paidC = Math.round(Number(paid) * 100);
    const [cur] = await sql<
      Array<{ status: string; paid_at: Date | null; manually_paid: boolean }>
    >`SELECT status, paid_at, manually_paid FROM credit_card_invoice WHERE id = ${invId}`;
    let newStatus: string = "open";
    if (cur.status === "closed") newStatus = "closed";
    if (totalC > 0 && paidC >= totalC) newStatus = "paid";
    if (cur.manually_paid) newStatus = "paid";
    const paidAt =
      newStatus === "paid" ? (cur.paid_at ?? new Date()) : null;
    await sql`
      UPDATE credit_card_invoice
         SET total_amount = ${total}, paid_amount = ${paid}, status = ${newStatus}, paid_at = ${paidAt}
       WHERE id = ${invId}
    `;
    console.log(`  ${invId.slice(0,8)}: total ${total}, paid ${paid}, status ${newStatus}`);
  };

  console.log("\nRecomputando faturas afetadas:");
  await recompute(marInv.id);
  for (const w of wrongInvoiceIds) await recompute(w);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
