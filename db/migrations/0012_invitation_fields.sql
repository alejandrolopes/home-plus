ALTER TABLE "invitation"
  ADD COLUMN IF NOT EXISTS "team_id" text;

ALTER TABLE "invitation"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now();
