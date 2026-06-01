CREATE TABLE "category_budget" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"category_id" uuid NOT NULL,
	"month" text,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "category_budget" ADD CONSTRAINT "category_budget_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_budget" ADD CONSTRAINT "category_budget_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_budget_org_idx" ON "category_budget" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "category_budget_default_unique" ON "category_budget" USING btree ("category_id") WHERE "category_budget"."month" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "category_budget_month_unique" ON "category_budget" USING btree ("category_id","month") WHERE "category_budget"."month" IS NOT NULL;