-- Acesso adicional a outras empresas (TenantAccess) alem da tenantId primaria do usuario.
-- Decisao do dono (23/08): so isSuperAdmin=true acessa tudo automaticamente; qualquer outro
-- usuario precisa de concessao explicita, gerenciada em UsuariosPage.tsx (ja existia no
-- frontend resgatado, faltava so a tabela + rotas). Ver design.md.

-- CreateTable
CREATE TABLE "tenant_access" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'leitor',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_access_userId_tenantId_key" ON "tenant_access"("userId", "tenantId");

-- CreateIndex
CREATE INDEX "tenant_access_tenantId_idx" ON "tenant_access"("tenantId");

-- AddForeignKey
ALTER TABLE "tenant_access" ADD CONSTRAINT "tenant_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_access" ADD CONSTRAINT "tenant_access_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS consistente com as demais tabelas (ver _init_rls) — hoje dormente (app.tenant_id
-- nunca e setado via withTenant(), so o filtro em nivel de app roda), mas mantido pra
-- nao divergir do padrao caso withTenant() passe a ser usado.
ALTER TABLE "tenant_access" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_access" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_access"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
