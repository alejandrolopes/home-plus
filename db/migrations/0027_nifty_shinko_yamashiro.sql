CREATE TABLE "organization_modules" (
	"organization_id" text NOT NULL,
	"module_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_modules_organization_id_module_key_pk" PRIMARY KEY("organization_id","module_key")
);
--> statement-breakpoint
ALTER TABLE "organization_modules" ADD CONSTRAINT "organization_modules_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;