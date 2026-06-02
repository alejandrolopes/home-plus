ALTER TABLE "plan" ADD COLUMN "linked_account_id" uuid;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "linked_investment_id" uuid;--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_linked_account_id_financial_account_id_fk" FOREIGN KEY ("linked_account_id") REFERENCES "public"."financial_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_linked_investment_id_investment_id_fk" FOREIGN KEY ("linked_investment_id") REFERENCES "public"."investment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_linked_account_idx" ON "plan" USING btree ("linked_account_id") WHERE "plan"."linked_account_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "plan_linked_investment_idx" ON "plan" USING btree ("linked_investment_id") WHERE "plan"."linked_investment_id" IS NOT NULL;