-- % de dízimo / oferta pacto por usuário (cada membro pode ter os seus).
-- O liga/desliga (tithing_enabled) continua na organização (admin habilita
-- a feature para a família).
CREATE TABLE "user_finance_settings" (
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "tithing_pct" numeric(5,2) NOT NULL DEFAULT 10,
  "pact_offering_pct" numeric(5,2) NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("organization_id", "user_id")
);
