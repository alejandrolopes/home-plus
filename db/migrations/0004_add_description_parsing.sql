ALTER TABLE "transaction" ADD COLUMN "clean_description" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "counterparty_name" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "counterparty_document" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "counterparty_bank" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "counterparty_branch" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "counterparty_account" text;--> statement-breakpoint
CREATE INDEX "transaction_counterparty_idx" ON "transaction" USING btree ("organization_id","counterparty_name") WHERE "transaction"."counterparty_name" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "transaction_payment_method_idx" ON "transaction" USING btree ("organization_id","payment_method");