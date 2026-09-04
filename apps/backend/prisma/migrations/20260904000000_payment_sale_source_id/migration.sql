-- Auditoria 04/09: pagamento que chega antes da venda ficava sem saleId para sempre.
ALTER TABLE "payments" ADD COLUMN "saleSourceId" TEXT;
CREATE INDEX "payments_tenantId_storeId_saleSourceId_idx" ON "payments"("tenantId", "storeId", "saleSourceId");
