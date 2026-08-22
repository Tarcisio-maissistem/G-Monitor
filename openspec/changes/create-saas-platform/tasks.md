## 1. Bootstrap do monorepo

- [x] 1.1 Criar estrutura `apps/backend`, `apps/agent`, `apps/web`, `packages/shared`, `packages/rpc-contracts`
- [x] 1.2 Configurar pnpm workspaces + TypeScript root config
- [x] 1.3 Configurar ESLint + Prettier + Husky pre-commit + lint-staged
- [x] 1.4 Configurar Vitest no root + 2 testes iniciais
- [x] 1.5 Configurar GitHub Actions: lint, type-check, test, build
- [x] 1.6 `.editorconfig`, `.gitignore`, `.nvmrc` (20.19+)
- [x] 1.7 `docker-compose.dev.yml` com Postgres 16 + Redis 7 + Grafana/Loki/Prometheus
- [x] 1.8 Backend escuta porta 6060 (HTTP + WS sob mesma porta)

## 2. Infraestrutura VPS

- [ ] 2.1 Provisionar VPS (Hetzner ou Hostinger BR, mínimo 4 vCPU / 8 GB / 80 GB SSD) — só backend/web/Redis/observabilidade, Postgres nao entra mais (Supabase)
- [x] 2.2 Dockerfiles backend + web + Nginx + Certbot (estrutura criada, falta executar deploy)
- [x] 2.3 `docker-compose.prod.yml` com backend, web, postgres, redis, grafana, loki, prometheus, certbot — `postgres` do compose fica so pra teste local isolado, prod usa Supabase (D3)
- [ ] 2.4 Domínio `app.gmonitor.com.br` + `api.gmonitor.com.br` + `ws.gmonitor.com.br`
- [ ] 2.5 Backup do Postgres — confirmar plano do Supabase (backup diário/PITR só entra a partir do plano Pro; free tier não tem)
- [ ] 2.6 Firewall: 22, 80, 443 abertos; resto fechado
- [x] 2.7 Projeto Supabase criado (`G-Monitor`, sa-east-1, ref `hpxvzkzjohkrmkgvkiat`) + schema completo aplicado (4 migrations, 17 policies RLS) — 22/08

## 3. Banco multi-tenant

- [x] 3.1 Instalar Prisma + cliente Postgres
- [x] 3.2 Schema admin (`tenants`, `users`, `refresh_tokens`, `stores`, `agents`, `agent_sessions`, `audit_logs`, `subscriptions`, `invitations`)
- [x] 3.3 Schema operacional (`sales`, `sale_items`, `payments`, `customers`, `products`, `cash_closings`, `sync_state`)
- [x] 3.4 Migration: habilitar RLS em todas as tabelas com `tenant_id`
- [x] 3.5 Policy RLS: `tenant_isolation` filtra por `current_setting('app.tenant_id')`
- [x] 3.6 Helper `withTenant(tenantId, fn)` para setar contexto
- [ ] 3.7 Testes de isolamento: tentativa de leitura cruzada deve falhar

## 4. Auth e identidade

- [x] 4.1 Endpoint `POST /api/auth/signup` (cria tenant + owner)
- [x] 4.2 Endpoint `POST /api/auth/login` (email + senha + 2FA opcional)
- [x] 4.3 Endpoint `POST /api/auth/refresh` (rotaciona refresh token + detecta reuso)
- [x] 4.4 Endpoint `POST /api/auth/logout` (revoga refresh)
- [x] 4.5 Endpoints `POST /api/auth/2fa/enroll`, `verify`, `disable`
- [x] 4.6 Hash de senha com argon2id
- [x] 4.7 JWT access 15min + refresh 30d (httpOnly cookie, secure, sameSite=lax)
- [x] 4.8 Middleware `requireAuth` + `requireCapability`
- [ ] 4.9 Rate-limit: 5 tentativas / 5 min por IP+email
- [ ] 4.10 Teste: signup, login, refresh, 2FA, lockout

## 5. Gestão de tenants e usuários

- [x] 5.1 `GET /api/tenant/me` retorna dados do tenant
- [x] 5.2 `PATCH /api/tenant/me` atualiza nome/CNPJ/telefone
- [ ] 5.3 `GET/POST/DELETE /api/tenant/users` (CRUD com papéis)
- [ ] 5.4 Convite por email com token de 7 dias
- [x] 5.5 `GET/POST /api/tenant/stores` (PATCH/DELETE pendente)
- [x] 5.6 Soft delete em todas as entidades (`deletedAt` em schema)
- [ ] 5.7 Teste: owner gerencia, gestor não promove

## 6. Agente Windows

- [x] 6.1 Bootstrap projeto `apps/agent` TypeScript
- [x] 6.2 Conexão WebSocket TLS com reconexão exponencial (1s → 60s, jitter)
- [x] 6.3 Handshake: envia token, recebe `agent_session_id`
- [x] 6.4 Heartbeat: ping a cada 25s, considera desconectado se 60s sem pong
- [x] 6.5 Cliente `node-firebird` com pool de 5 conexões
- [x] 6.6 Catálogo de queries inicial (sales, sales-by-payment, sync-batch, ping-db)
- [x] 6.7 Handler RPC: `ping`, `getAgentInfo`, `runReport`
- [x] 6.8 Sync incremental: SQLite local (`better-sqlite3`) com checkpoints por tabela
- [ ] 6.9 Detecção automática de caminho do Firebird + versão (config manual ok no MVP)
- [ ] 6.10 Auto-update com Ed25519 + rollback
- [x] 6.11 Empacotamento via script `pnpm package` (pkg windows-x64)
- [x] 6.12 Instalador PowerShell parametrizado (Inno Setup como evolução)
- [x] 6.13 Serviço Windows via NSSM (instrução no install.ps1)
- [ ] 6.14 Tray icon mostrando status
- [x] 6.15 Log local com pino (`%PROGRAMDATA%\GMonitor\logs\`)

## 7. Protocolo RPC

- [x] 7.1 Contratos em `packages/rpc-contracts` com Zod
- [x] 7.2 Encoding msgpack (`msgpackr`)
- [x] 7.3 Operações: `ping`, `getAgentInfo`, `getSchema`, `runReport`, `syncTick`, `syncBatch`, `rotateToken`, `checkUpdate`, `forceUpdate`, `updateCatalog`
- [x] 7.4 Timeout por operação (30s default, override por op)
- [x] 7.5 Backpressure: agente recusa nova RPC se houver 10+ pendentes
- [x] 7.6 Versionamento de protocolo (`protocol_version` no handshake)

## 8. Backend SaaS — query routing

- [x] 8.1 Servidor WebSocket Fastify em `/ws/agent`
- [x] 8.2 Registry em memória + Redis: `agent_id → ws_connection`
- [ ] 8.3 BullMQ queue por agente (atual usa Map em memória; cross-instance pendente)
- [x] 8.4 Endpoint `POST /api/agents/:id/ping` (auth admin) chama RPC
- [x] 8.5 Fallback: se agente offline retorna 503 (snapshot via reports)
- [x] 8.6 Métrica: `agent_rpc_latency_seconds` registrada

## 9. Sync incremental

- [x] 9.1 Tabela `sync_state` no Postgres SaaS com checkpoint por (tenant, store, table)
- [x] 9.2 Loop syncTick a cada `syncIntervalMs` (default 30s)
- [x] 9.3 Empurra deltas via POST `/api/agent/sync` (1000 linhas/lote)
- [x] 9.4 Upsert idempotente com Prisma `upsert` por `tenantId_storeId_sourceId`
- [ ] 9.5 Job de reconciliação por COUNT (worker BullMQ, cadência 1h — ver design.md D12), substitui a ideia de "noturna" original
- [x] 9.6 Métrica `sync_lag_seconds` (gauge registrado)
- [ ] 9.7 RPC de re-sync avulso (backend pede ao agente um range especifico quando a reconciliação acha lacuna, sem refazer a tabela inteira)
- [ ] 9.8 Catalogo RPC `count-*` no agente (COUNT por tabela no Firebird, pro job 9.5 comparar com o Postgres)

## 10. Relatórios

- [x] 10.1 `GET /api/reports/sales-summary` (implementado)
- [x] 10.2 `GET /api/reports/sales-by-payment` (skeleton)
- [x] 10.3 `GET /api/reports/abc-products` (implementado com cálculo ABC)
- [x] 10.4 `GET /api/reports/dre-simplified` (skeleton)
- [x] 10.5 `GET /api/reports/stockout` (skeleton)
- [x] 10.6 `GET /api/reports/inadimplencia-aging` (skeleton)
- [x] 10.7 `GET /api/reports/operator-commission` (skeleton)
- [x] 10.8 `GET /api/reports/customer-cohort` (skeleton)
- [ ] 10.9 Exportação CSV/XLSX por relatório
- [ ] 10.10 Cache Redis por (tenant, report, params) com TTL adaptativo
- [x] 10.11 Schema Prisma `Payable`/`Receivable` (contas a pagar/receber, isolado por tenant+loja)
- [x] 10.12 Agente: deteccao de schema financeiro (`CONTAS_PAGAR`/`CONTAS_RECEBER` x `PAGAR`/`RECEBER`) via `RDB$RELATIONS`
- [x] 10.13 Agente: catalogo + sync incremental `CONTAS_PAGAR`/`CONTAS_RECEBER` -> Postgres
- [x] 10.14 `GET /api/reports/payables-calendar` e `/api/reports/receivables-calendar` (totais por dia + resumo do mes)
- [x] 10.15 `GET /api/reports/payables` e `/api/reports/receivables` (lista com filtro de status)
- [ ] 10.16 Migration Prisma aplicada em ambiente com Postgres (`prisma migrate dev`) — pendente rodar contra banco real
- [ ] 10.17 Validar em campo o schema `PAGAR`/`RECEBER` (variante simples) num cliente piloto para decidir se entra no catalogo

## 11. Frontend web

- [x] 11.1 Bootstrap Vite + React 18 + Tailwind + TanStack Query + Zustand
- [x] 11.2 Páginas iniciais: Login + Dashboard (resto pendente)
- [ ] 11.3 Componentes: tabela, gráficos Recharts lazy, date range picker
- [ ] 11.4 Indicador de status do agente em cada loja
- [x] 11.5 Modo degradado: banner staleness no Dashboard
- [x] 11.6 Tailwind responsivo mobile-first
- [ ] 11.7 i18n estruturado (atual usa pt-BR direto)
- [x] 11.8 Code splitting (manualChunks no vite.config.ts)
- [ ] 11.9 Build < 800 KB JS inicial
- [x] 11.10 Calendário mensal de contas a pagar e de contas a receber (abas no Dashboard)

## 12. Observabilidade

- [x] 12.1 `pino` em backend e agente, JSON estruturado + redact de senhas/tokens
- [ ] 12.2 Promtail envia logs do agente para Loki via HTTPS
- [x] 12.3 Métricas Prometheus expostas em `/metrics` (HTTP, WS, RPC, sync lag)
- [ ] 12.4 Dashboards Grafana: visão geral, por tenant, por store
- [ ] 12.5 Alertas: agente offline > 5min, erro 5xx > 1%, Stripe webhook falha
- [ ] 12.6 Tracing distribuído (OpenTelemetry) opcional

## 13. Auditoria

- [x] 13.1 Tabela `audit_logs` no schema Prisma
- [x] 13.2 Middleware `audit()` factory para registrar pós-resposta
- [x] 13.3 `GET /api/audit` com filtros entity/from/to + bloqueio PATCH/DELETE
- [ ] 13.4 Job de retenção 2 anos + archive frio

## 14. Cobrança

- [ ] 14.1 Conta Stripe + produtos + preços (criar manualmente no painel)
- [x] 14.2 Endpoint `/api/stripe/checkout` cria session
- [x] 14.3 Endpoint `/api/stripe/portal` redireciona para Customer Portal
- [x] 14.4 Webhook `/api/stripe/webhook` valida assinatura + atualiza tenant/subscription
- [ ] 14.5 Reconciliador horário (job BullMQ)
- [ ] 14.6 Bloqueio gradual (regra implementada apenas no schema; lógica pendente)
- [ ] 14.7 Emails transacionais via Resend

## 15. Notificações

- [x] 15.1 Tabela `notification_rules` no schema Prisma
- [x] 15.2 Regra inicial `agent_offline` (demais pendentes)
- [x] 15.3 Worker BullMQ com schedule de 5min
- [x] 15.4 Canal in-app via tabela `notifications` + endpoints
- [x] 15.5 Tabela `notification_preferences` por usuário (toggle por tipo)

## 16. Agente auto-updater

- [ ] 16.1 Endpoint `/api/agent/release/latest?channel=stable&platform=win-x64`
- [ ] 16.2 Hash SHA-256 + assinatura Ed25519 do binário
- [ ] 16.3 Cliente verifica e instala em pasta nova, troca symlink, reinicia
- [ ] 16.4 Rollback automático se 3 health checks falharem após update
- [ ] 16.5 Rollout em ondas (canary 5% → 25% → 100%) via flag de release

## 17. Segurança

- [ ] 17.1 Headers Helmet: CSP, HSTS, X-Frame-Options
- [ ] 17.2 Rate limit por IP e por token em endpoints sensíveis
- [ ] 17.3 Secrets via variáveis de ambiente + Doppler ou SOPS
- [ ] 17.4 Banco com `pgcrypto` para campos sensíveis (token agente, 2FA secret)
- [ ] 17.5 Pentest interno antes do lançamento (lista OWASP top 10)
- [ ] 17.6 Política de senha: mínimo 12 char, sem reuso das 5 últimas
- [ ] 17.7 Lockout: 5 falhas = bloqueio 15 min com captcha após

## 18. Documentação e onboarding

- [x] 18.1 README do monorepo + SETUP.md completo (dev local + VPS + agente)
- [ ] 18.2 Guia de instalação do agente em PDF
- [ ] 18.3 Tutoriais em vídeo
- [ ] 18.4 Página pública de status
- [ ] 18.5 Política de Privacidade + Termos de Uso + LGPD

## 19. Lançamento

- [ ] 19.1 Migrar 1–2 clientes piloto, acompanhar 30 dias
- [ ] 19.2 Ajustes a partir do feedback
- [ ] 19.3 Pricing público + landing page de vendas
- [ ] 19.4 Programa de afiliados ou primeiro mês grátis
