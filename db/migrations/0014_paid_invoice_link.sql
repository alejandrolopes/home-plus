-- Vínculo direto de uma transação de pagamento à fatura paga.
-- Quando preenchido, esta transação NÃO é contada como despesa nos
-- summaries (evita duplicar com as compras do cartão).
ALTER TABLE "transaction"
  ADD COLUMN "paid_invoice_id" uuid REFERENCES "credit_card_invoice"("id")
    ON DELETE SET NULL;

CREATE INDEX "transaction_paid_invoice_idx"
  ON "transaction"("paid_invoice_id")
  WHERE "paid_invoice_id" IS NOT NULL;

-- Backfill: tenta casar transações de payment_method=card_invoice_payment
-- com a fatura correspondente.
-- 1) Faturas vinculadas via external_payment_id = 'linked:<txId>'
UPDATE "transaction" t
SET "paid_invoice_id" = ci."id"
FROM "credit_card_invoice" ci
WHERE ci."external_payment_id" = 'linked:' || t."id"::text
  AND t."paid_invoice_id" IS NULL;

-- 2) Faturas pagas pelo fluxo "Criar pagamento" (sem external_payment_id linked):
--    procura fatura paga do mesmo org com paid_at na mesma data e amount igual.
UPDATE "transaction" t
SET "paid_invoice_id" = ci."id"
FROM "credit_card_invoice" ci
WHERE t."payment_method" = 'card_invoice_payment'
  AND t."paid_invoice_id" IS NULL
  AND ci."organization_id" = t."organization_id"
  AND ci."status" = 'paid'
  AND ci."total_amount" = t."amount"
  AND ABS(EXTRACT(EPOCH FROM (ci."paid_at" - (t."occurred_on" || ' 00:00:00')::timestamp))) < 60 * 60 * 24 * 3;
