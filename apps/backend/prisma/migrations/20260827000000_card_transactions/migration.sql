-- Transacoes de cartao capturadas pelo GDOOR (MOVIMENTACAO_CARTAO).
-- Motivo: `processed = false` = cobrou o cliente e a venda nao fechou. Em agosto/2026 havia
-- exatamente 1 no piloto (R$ 567,80), a mesma que a conciliacao contra o portal apontou.
-- Ter a tabela permite alertar na hora, sem depender de raspar o portal do fornecedor.

CREATE TABLE "card_transactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "acquirer" TEXT,
    "nsu" TEXT,
    "authCode" TEXT,
    "value" DECIMAL(14,2) NOT NULL,
    "installments" INTEGER,
    "transactionAt" TIMESTAMP(3) NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT true,
    "paymentSourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "card_transactions_tenantId_storeId_sourceId_key"
    ON "card_transactions"("tenantId", "storeId", "sourceId");
CREATE INDEX "card_transactions_tenantId_storeId_transactionAt_idx"
    ON "card_transactions"("tenantId", "storeId", "transactionAt");
CREATE INDEX "card_transactions_tenantId_storeId_processed_idx"
    ON "card_transactions"("tenantId", "storeId", "processed");

ALTER TABLE "card_transactions" ADD CONSTRAINT "card_transactions_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ARMADILHA conhecida: neste projeto tabela nova nasce com grant para o anonimo por causa do
-- `alter default privileges`. Fechar explicitamente — o dado de venda de uma loja nao pode
-- ficar legivel/gravavel por qualquer um.
REVOKE ALL ON TABLE "card_transactions" FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE "card_transactions" TO service_role;

ALTER TABLE "card_transactions" ENABLE ROW LEVEL SECURITY;
