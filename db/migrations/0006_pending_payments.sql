CREATE TYPE "public"."pending_payment_status" AS ENUM('pending', 'linked', 'dismissed');--> statement-breakpoint
CREATE TABLE "import_pending_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"occurred_on" date NOT NULL,
	"raw_description" text NOT NULL,
	"source" text NOT NULL,
	"status" "pending_payment_status" DEFAULT 'pending' NOT NULL,
	"linked_invoice_id" uuid,
	"import_session_id" uuid,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_card_invoice" ADD COLUMN "external_payment_id" text;--> statement-breakpoint
ALTER TABLE "import_pending_payment" ADD CONSTRAINT "import_pending_payment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_pending_payment" ADD CONSTRAINT "import_pending_payment_account_id_financial_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_pending_payment" ADD CONSTRAINT "import_pending_payment_linked_invoice_id_credit_card_invoice_id_fk" FOREIGN KEY ("linked_invoice_id") REFERENCES "public"."credit_card_invoice"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_pending_payment" ADD CONSTRAINT "import_pending_payment_import_session_id_import_session_id_fk" FOREIGN KEY ("import_session_id") REFERENCES "public"."import_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_payment_org_idx" ON "import_pending_payment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pending_payment_account_idx" ON "import_pending_payment" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "pending_payment_external_idx" ON "import_pending_payment" USING btree ("organization_id","external_id");--> statement-breakpoint
CREATE INDEX "invoice_external_payment_idx" ON "credit_card_invoice" USING btree ("organization_id","external_payment_id") WHERE "credit_card_invoice"."external_payment_id" IS NOT NULL;