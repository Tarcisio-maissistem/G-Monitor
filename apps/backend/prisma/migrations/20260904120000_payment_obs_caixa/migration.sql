-- 0.9.9: motivo e caixa da sangria vindos do MOV_OPERADORES (duvida do dono 04/09).
ALTER TABLE "payments" ADD COLUMN "obs" TEXT;
ALTER TABLE "payments" ADD COLUMN "caixa" TEXT;
ALTER TABLE "payments" ADD COLUMN "operador" TEXT;
