ALTER TABLE "transaction" DROP CONSTRAINT "transaction_account_id_financial_account_id_fk";
--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_account_id_financial_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_account"("id") ON DELETE set null ON UPDATE no action;