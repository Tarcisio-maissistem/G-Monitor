-- Autocadastro pelo login (pedido do dono 24/08): tenant criado por /api/auth/signup ou
-- pelo instalador via CNPJ nasce pendingApproval=true. WS/sync do agente ficam bloqueados
-- ate o super-admin aprovar (POST /api/admin/tenants/:id/approve). Default false preserva
-- todos os tenants existentes como ja aprovados.

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "pendingApproval" BOOLEAN NOT NULL DEFAULT false;
