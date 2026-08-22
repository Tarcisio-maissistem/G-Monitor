-- Contas a pagar/receber sincronizadas de CONTAS_PAGAR/CONTAS_RECEBER (Firebird/GDOOR).
-- Ver openspec/changes/create-saas-platform/design.md D11.

-- CreateTable
CREATE TABLE "payables" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "paidValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidDate" TIMESTAMP(3),
    "counterparty" TEXT,
    "description" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivables" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "receivedValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "receivedDate" TIMESTAMP(3),
    "counterparty" TEXT,
    "description" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receivables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payables_tenantId_storeId_sourceId_key" ON "payables"("tenantId", "storeId", "sourceId");

-- CreateIndex
CREATE INDEX "payables_tenantId_storeId_dueDate_idx" ON "payables"("tenantId", "storeId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "receivables_tenantId_storeId_sourceId_key" ON "receivables"("tenantId", "storeId", "sourceId");

-- CreateIndex
CREATE INDEX "receivables_tenantId_storeId_dueDate_idx" ON "receivables"("tenantId", "storeId", "dueDate");

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Habilita RLS nas duas tabelas novas, mesma policy de _init_rls (filtro por app.tenant_id).
ALTER TABLE "payables" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payables" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payables"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "receivables" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "receivables" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "receivables"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
