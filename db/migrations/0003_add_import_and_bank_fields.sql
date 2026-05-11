CREATE TABLE "import_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"source" text NOT NULL,
	"filename" text,
	"period_start" date,
	"period_end" date,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"account_created" boolean DEFAULT false NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financial_account" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "financial_account" ADD COLUMN "bank_id" text;--> statement-breakpoint
ALTER TABLE "financial_account" ADD COLUMN "account_number" text;--> statement-breakpoint
ALTER TABLE "financial_account" ADD COLUMN "account_branch" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "import_session_id" uuid;--> statement-breakpoint
ALTER TABLE "import_session" ADD CONSTRAINT "import_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_session" ADD CONSTRAINT "import_session_account_id_financial_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_session" ADD CONSTRAINT "import_session_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_session_org_idx" ON "import_session" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "import_session_account_idx" ON "import_session" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "transaction_external_idx" ON "transaction" USING btree ("organization_id","account_id","external_id") WHERE "transaction"."external_id" IS NOT NULL;