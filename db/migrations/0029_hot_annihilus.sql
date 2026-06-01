CREATE TABLE "plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"owner_id" text,
	"name" text NOT NULL,
	"description" text,
	"target_cents" integer NOT NULL,
	"current_cents" integer DEFAULT 0 NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"color" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_contribution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"contributor_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"occurred_on" date NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_contribution" ADD CONSTRAINT "plan_contribution_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_contribution" ADD CONSTRAINT "plan_contribution_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_contribution" ADD CONSTRAINT "plan_contribution_contributor_id_user_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_org_idx" ON "plan" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "plan_owner_idx" ON "plan" USING btree ("organization_id","owner_id");--> statement-breakpoint
CREATE INDEX "plan_contribution_plan_idx" ON "plan_contribution" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "plan_contribution_org_idx" ON "plan_contribution" USING btree ("organization_id");