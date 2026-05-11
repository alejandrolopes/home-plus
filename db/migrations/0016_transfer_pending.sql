-- Aceite de transferência entre membros da família.
-- Quando A cria transferência para conta de B (donos diferentes), só a perna
-- de A é gravada; ela fica com pending_status='pending' até que B aceite
-- (criando uma perna nova ou vinculando a um lançamento existente) ou recuse.
CREATE TYPE "transfer_pending_status" AS ENUM ('pending');

ALTER TABLE "transaction"
  ADD COLUMN "pending_status" "transfer_pending_status",
  ADD COLUMN "requested_by_user_id" text REFERENCES "user"("id") ON DELETE RESTRICT;

CREATE INDEX "transaction_pending_transfer_idx"
  ON "transaction"("organization_id", "transfer_to_account_id")
  WHERE "pending_status" = 'pending';
