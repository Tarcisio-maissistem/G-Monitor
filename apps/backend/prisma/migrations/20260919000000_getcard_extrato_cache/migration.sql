-- Extrato do portal guardado por dia consultado (19/09): dia fechado nao e baixado de novo.
CREATE TABLE "getcard_linhas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dia" DATE NOT NULL,
    "pdv" TEXT NOT NULL,
    "nsu" TEXT NOT NULL,
    "cartao" TEXT NOT NULL,
    "parcelas" INTEGER NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "adquirente" TEXT NOT NULL,
    "bandeira" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "hora" TEXT NOT NULL,
    "nsuHost" TEXT NOT NULL,
    "autorizacao" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "autorizada" BOOLEAN NOT NULL,
    CONSTRAINT "getcard_linhas_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "getcard_linhas_tenantId_dia_idx" ON "getcard_linhas"("tenantId", "dia");

CREATE TABLE "getcard_dias" (
    "tenantId" TEXT NOT NULL,
    "dia" DATE NOT NULL,
    "qtd" INTEGER NOT NULL,
    "paginas" INTEGER NOT NULL,
    "fechado" BOOLEAN NOT NULL,
    "baixadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "getcard_dias_pkey" PRIMARY KEY ("tenantId", "dia")
);
