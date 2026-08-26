-- P5 (26/08): MOV_OPERADORES.TIPO normalizado — sangria/suprimento sao movimento de caixa,
-- nao receita. Nullable: linha de agente antigo = null (tratada como venda).
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "kind" TEXT;
CREATE INDEX IF NOT EXISTS "payments_tenant_store_kind_idx" ON "payments" ("tenantId", "storeId", "kind");
