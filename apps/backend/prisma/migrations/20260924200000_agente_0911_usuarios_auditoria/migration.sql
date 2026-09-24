-- Agente 0.9.11 (gestor J.Kastros 24/09): hora do movimento, desconto/cancelamento/vendedor do
-- item, plano de contas da conta a pagar, usuarios do GDOOR e trilha de auditoria.
ALTER TABLE "payments" ADD COLUMN "hora" TEXT;

ALTER TABLE "sale_items" ADD COLUMN "discount" DECIMAL(14,2);
ALTER TABLE "sale_items" ADD COLUMN "itemCancelled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sale_items" ADD COLUMN "seller" TEXT;

ALTER TABLE "payables" ADD COLUMN "accountCode" TEXT;
ALTER TABLE "payables" ADD COLUMN "costCenter" TEXT;

-- USUARIOS do GDOOR (sem senha): nome por ID + permissoes de desconto/cancelamento
CREATE TABLE "gdoor_users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "supervisor" BOOLEAN NOT NULL DEFAULT false,
    "cancelaItem" BOOLEAN NOT NULL DEFAULT false,
    "descontoItem" BOOLEAN NOT NULL DEFAULT false,
    "cancelaCupom" BOOLEAN NOT NULL DEFAULT false,
    "descontoCupom" BOOLEAN NOT NULL DEFAULT false,
    "descontoMax" DECIMAL(14,2),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gdoor_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "gdoor_users_tenantId_storeId_sourceId_key" ON "gdoor_users"("tenantId", "storeId", "sourceId");

-- AUDITORIA do GDOOR (quem cancelou/liberou desconto). Sem ID na origem: hash da linha.
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "info" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "hora" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "audit_events_tenantId_storeId_hash_key" ON "audit_events"("tenantId", "storeId", "hash");
CREATE INDEX "audit_events_tenantId_storeId_data_idx" ON "audit_events"("tenantId", "storeId", "data");
