CREATE TABLE "reimbursement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"expense_tx_id" uuid NOT NULL,
	"income_tx_id" uuid,
	"expected_from" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reimbursement_expense_tx_id_unique" UNIQUE("expense_tx_id")
);
--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "is_reimbursable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reimbursement" ADD CONSTRAINT "reimbursement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement" ADD CONSTRAINT "reimbursement_expense_tx_id_transaction_id_fk" FOREIGN KEY ("expense_tx_id") REFERENCES "public"."transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement" ADD CONSTRAINT "reimbursement_income_tx_id_transaction_id_fk" FOREIGN KEY ("income_tx_id") REFERENCES "public"."transaction"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reimbursement_org_idx" ON "reimbursement" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "reimbursement_income_idx" ON "reimbursement" USING btree ("income_tx_id") WHERE "reimbursement"."income_tx_id" IS NOT NULL;
