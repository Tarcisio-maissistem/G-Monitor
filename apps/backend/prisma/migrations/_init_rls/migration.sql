-- Habilita Row Level Security em todas as tabelas com tenant_id.
-- Policy: filtro por current_setting('app.tenant_id', true).
-- Backend seta o contexto a cada request com `SET LOCAL app.tenant_id = '<id>'`.

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenantId'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING ("tenantId" = current_setting(''app.tenant_id'', true))
         WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))',
      t.table_name
    );
  END LOOP;
END
$$;

-- Indice GIN para meta JSON em tenants (filtros futuros por config)
CREATE INDEX IF NOT EXISTS tenants_meta_gin ON tenants USING GIN (meta);
