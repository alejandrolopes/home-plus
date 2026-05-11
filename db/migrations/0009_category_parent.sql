-- Self-FK + índice para hierarquia de categorias (1 nível)
ALTER TABLE "category"
  ADD CONSTRAINT "category_parent_id_category_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "category"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "category_parent_idx"
  ON "category" USING btree ("parent_id")
  WHERE "category"."parent_id" IS NOT NULL;
