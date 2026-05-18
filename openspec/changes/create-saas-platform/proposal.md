## Why

O produto atual `gdoor-relatorio` foi pensado como instalação local por cliente. Ele tem:

- SQL injection generalizado por interpolação de query strings em SQL.
- Banco exposto via ngrok público sem autenticação efetiva (`authMiddleware` existe mas não é registrado).
- Sessões só em memória, perdidas a cada reinício.
- Bundle de 1.6 MB enviado por máquina cliente, sem code splitting.
- Operação 1-a-1: cada cliente é uma instalação, suporte e updates são manuais.
- Sem multi-tenant, sem auditoria, sem cobrança recorrente.

Para escalar para dezenas/centenas de clientes pagantes e profissionalizar o produto, é necessário migrar para um modelo SaaS multi-tenant hospedado em VPS, com um agente leve rodando na máquina da loja para conversar com o Firebird local — sem expor o banco à internet.

Esta change cria a fundação do G-Monitor: backend SaaS, agente Windows, autenticação multi-tenant, ponte com Firebird via RPC sobre WebSocket, sync incremental, dashboard de relatórios, observabilidade e cobrança.

## What Changes

- **NOVO projeto** `G-Monitor` em `C:\Users\Maissistem\Desktop\GDOOR\G-Monitor`, separado do `gdoor-relatorio` (que permanece para consulta/legado).
- Backend SaaS Node.js 20 + TypeScript + Fastify + Prisma + PostgreSQL 16 + Redis 7.
- Agente Windows Node.js 20 + TypeScript empacotado com `pkg`, instalado via NSSM, comunicação outbound WebSocket TLS.
- Driver Firebird nativo (`node-firebird`) com prepared statements — fim do SQL injection e do spawn de `isql.exe`.
- Multi-tenant nativo com Row Level Security no Postgres.
- Autenticação JWT (access + refresh) com 2FA TOTP opcional, token long-lived por agente rotacionável.
- Roteamento de queries: backend SaaS recebe request → fila Redis → agente certo → resposta.
- Sync incremental: agente empurra deltas de vendas/itens/pagamentos/estoque para Postgres SaaS (cache quente).
- Dashboard com relatórios pré-definidos (DRE simplificado, ABC, ruptura, inadimplência, cohort, vendas por período).
- Cobrança via Stripe (assinaturas + portal de cliente).
- Auditoria completa de mudanças sensíveis (metas, taxas, permissões).
- Observabilidade desde dia zero: pino + Loki + Prometheus + Grafana.
- Auto-update controlado do agente.
- Motor de notificações (meta não batida, queda anômala, ruptura, caixa em divergência).

## Capabilities

### New Capabilities

- `tenant-management`: cadastro, isolamento, configuração e ciclo de vida de tenants e suas lojas.
- `user-auth`: identidade, sessão, papéis e 2FA dos usuários da plataforma.
- `agent-connection`: handshake, sessão WebSocket persistente, heartbeat e reconexão do agente com o SaaS.
- `agent-rpc`: protocolo RPC tipado sobre WebSocket entre SaaS e agente.
- `firebird-bridge`: execução segura de queries no Firebird local pelo agente.
- `query-routing`: roteamento de requests do backend SaaS para o agente correto do tenant/loja.
- `data-sync`: sincronização incremental de dados operacionais do Firebird para o Postgres SaaS.
- `dashboard-reports`: endpoints e visualizações dos relatórios gerenciais.
- `observability`: telemetria de saúde, métricas de uso e alertas operacionais.
- `agent-updater`: distribuição e instalação controlada de novas versões do agente.
- `billing`: planos, assinaturas e cobrança recorrente via Stripe.
- `audit-log`: registro auditável de mudanças sensíveis.
- `notification-engine`: alertas de negócio enviados a usuários do tenant.

### Modified Capabilities

Nenhuma. Este é projeto novo (greenfield).

## Impact

- **Repositórios:** novo diretório `G-Monitor/` ao lado de `gdoor-relatorio/`. Projetos completamente separados.
- **Infraestrutura:** requer VPS Linux (1 inicial, ~8 GB RAM, BR), domínio + TLS (Let's Encrypt), conta Stripe, conta de email transacional (Resend/Postmark).
- **Operacional:** agente passa a ser distribuído via instalador único parametrizado por token do tenant — o cliente baixa, cola token, instala.
- **Migração:** clientes do `gdoor-relatorio` continuam funcionando. Migração para SaaS é opt-in por cliente, em paralelo. Não há cutover obrigatório.
- **LGPD:** dados de venda passam a ser replicados para o VPS (BR). Necessário contrato de processamento de dados com cada tenant.
- **Custo recorrente:** infra inicial ~R$ 200–500/mês (VPS + Postgres gerenciado opcional + storage + email).
- **Sem breaking changes** no projeto legado — `gdoor-relatorio` permanece intacto.
