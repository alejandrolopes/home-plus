ALTER TABLE "transaction" ADD COLUMN "reverses_transaction_id" uuid;--> statement-breakpoint
CREATE INDEX "transaction_reverses_idx" ON "transaction" USING btree ("reverses_transaction_id") WHERE "transaction"."reverses_transaction_id" IS NOT NULL;
