CREATE TYPE "public"."investment_class" AS ENUM('fixed_income', 'variable_income');--> statement-breakpoint
CREATE TABLE "investment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"owner_id" text,
	"institution" text NOT NULL,
	"issuer" text,
	"product_name" text NOT NULL,
	"class" "investment_class" NOT NULL,
	"maturity_date" date,
	"color" text,
	"notes" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investment_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investment_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"month" text NOT NULL,
	"applied_cents" integer DEFAULT 0 NOT NULL,
	"balance_cents" integer NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "investment" ADD CONSTRAINT "investment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment" ADD CONSTRAINT "investment_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_snapshot" ADD CONSTRAINT "investment_snapshot_investment_id_investment_id_fk" FOREIGN KEY ("investment_id") REFERENCES "public"."investment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_snapshot" ADD CONSTRAINT "investment_snapshot_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investment_org_idx" ON "investment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "investment_owner_idx" ON "investment" USING btree ("organization_id","owner_id");--> statement-breakpoint
CREATE INDEX "investment_snapshot_inv_idx" ON "investment_snapshot" USING btree ("investment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_snapshot_unique" ON "investment_snapshot" USING btree ("investment_id","month");