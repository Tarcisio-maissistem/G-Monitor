-- D20 Conferencia de Caixa (26/08): FECHAMENTO_CAIXA ganha pdv/openingAmount e nasce a tabela
-- das especies contadas pelo operador. Additivo.
ALTER TABLE "cash_closings" ADD COLUMN IF NOT EXISTS "pdv" TEXT;
ALTER TABLE "cash_closings" ADD COLUMN IF NOT EXISTS "openingAmount" DECIMAL(14,2);
CREATE TABLE IF NOT EXISTS "cash_closing_species" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "closingId" TEXT NOT NULL,
  "closingSourceId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "especie" TEXT NOT NULL,
  "counted" DECIMAL(14,2) NOT NULL,
  CONSTRAINT "cash_closing_species_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cash_closing_species_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "cash_closings"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "cash_closing_species_tenantId_storeId_sourceId_key" ON "cash_closing_species"("tenantId","storeId","sourceId");
CREATE INDEX IF NOT EXISTS "cash_closing_species_tenantId_storeId_closingSourceId_idx" ON "cash_closing_species"("tenantId","storeId","closingSourceId");
ALTER TABLE "cash_closing_species" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_closing_species" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cash_closing_species" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
