-- Configurações de Fidelidade (dízimos e oferta pacto) por organização.
CREATE TABLE "organization_finance_settings" (
  "organization_id" text PRIMARY KEY REFERENCES "organization"("id") ON DELETE CASCADE,
  "tithing_enabled" boolean NOT NULL DEFAULT false,
  "tithing_pct" numeric(5,2) NOT NULL DEFAULT 10,
  "pact_offering_pct" numeric(5,2) NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Marcador "dizimável" em lançamentos de receita (e em filhas de splits de receita).
ALTER TABLE "transaction"
  ADD COLUMN "is_tithable" boolean NOT NULL DEFAULT false;

CREATE INDEX "transaction_tithable_idx"
  ON "transaction"("organization_id", "occurred_on")
  WHERE "is_tithable" = true;
