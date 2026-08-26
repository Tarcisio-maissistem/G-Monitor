-- Grafico de horario de pico (VENDAS.HORA_SAIDA) e ranking por vendedor (VENDAS.VENDEDOR,
-- != OPERADOR do caixa) — pedido do dono 25/08. Additivo, nullable: nada existente muda.
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "saleHour" INTEGER;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "sellerName" TEXT;
-- indice pro pico (agrega por hora nos ultimos N dias) e pro ranking por vendedor
CREATE INDEX IF NOT EXISTS "sales_tenant_store_hour_idx" ON "sales" ("tenantId", "storeId", "saleHour");
CREATE INDEX IF NOT EXISTS "sales_tenant_store_seller_idx" ON "sales" ("tenantId", "storeId", "sellerName");
