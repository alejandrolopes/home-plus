-- 1. financial_account ganha owner_id
ALTER TABLE "financial_account" ADD COLUMN "owner_id" text;

UPDATE "financial_account" fa
SET "owner_id" = (
  SELECT m."user_id"
  FROM "member" m
  WHERE m."organization_id" = fa."organization_id"
  ORDER BY m."created_at" ASC
  LIMIT 1
);

ALTER TABLE "financial_account"
  ALTER COLUMN "owner_id" SET NOT NULL;

ALTER TABLE "financial_account"
  ADD CONSTRAINT "financial_account_owner_id_fk"
    FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE RESTRICT;

CREATE INDEX "financial_account_owner_idx"
  ON "financial_account"("organization_id", "owner_id");

-- 2. transaction ganha owner_id (denormalizado para queries rápidas)
ALTER TABLE "transaction" ADD COLUMN "owner_id" text;

UPDATE "transaction" t
SET "owner_id" = COALESCE(
  t."created_by_id",
  (SELECT fa."owner_id" FROM "financial_account" fa WHERE fa."id" = t."account_id")
);

UPDATE "transaction" t
SET "owner_id" = (
  SELECT m."user_id"
  FROM "member" m
  WHERE m."organization_id" = t."organization_id"
  ORDER BY m."created_at" ASC
  LIMIT 1
)
WHERE t."owner_id" IS NULL;

ALTER TABLE "transaction"
  ALTER COLUMN "owner_id" SET NOT NULL;

ALTER TABLE "transaction"
  ADD CONSTRAINT "transaction_owner_id_fk"
    FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE RESTRICT;

CREATE INDEX "transaction_owner_idx"
  ON "transaction"("organization_id", "owner_id", "occurred_on" DESC);
