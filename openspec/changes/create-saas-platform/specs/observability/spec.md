## ADDED Requirements

### Requirement: Logs estruturados em JSON
Todos os componentes (backend, agente, workers) emitem logs em JSON com campos padrão.

#### Scenario: Campos obrigatórios em cada log
- **WHEN** qualquer componente emite um log
- **THEN** inclui `ts`, `level`, `msg`, `service`, `version`, `tenant_id` (quando aplicável), `request_id` (quando aplicável)

#### Scenario: Senhas e tokens nunca aparecem em log
- **WHEN** um log incluiria campo sensível (senha, token, refresh, 2FA secret)
- **THEN** o valor é substituído por `***` antes da emissão

### Requirement: Centralização de logs em Loki
Logs do agente são enviados ao Loki via HTTPS com retry; logs do backend chegam por stdout coletado por Promtail.

#### Scenario: Agente perde conexão e bufferiza logs localmente
- **WHEN** o agente está offline
- **THEN** logs são gravados localmente com rotação diária e enviados em lote quando a conexão volta, até limite de 100 MB

### Requirement: Métricas Prometheus expostas
Backend e agente expõem endpoint `/metrics` no padrão Prometheus.

#### Scenario: Backend exporta métricas HTTP e WS
- **WHEN** Prometheus faz scrape em `/metrics`
- **THEN** estão disponíveis: `http_request_duration_seconds`, `agent_sessions_active`, `agent_rpc_latency_seconds`, `sync_lag_seconds`, `report_cache_hit_ratio`

#### Scenario: Agente exporta métricas locais
- **WHEN** o agente é acessado (via canal interno seguro) em `/metrics`
- **THEN** expõe: `firebird_pool_active`, `firebird_query_duration_seconds`, `rpc_pending_count`, `sync_rows_sent_total`

### Requirement: Dashboards Grafana padrão
A plataforma fornece dashboards prontos para visão geral, saúde por tenant e saúde por agente.

#### Scenario: Visão "agentes" mostra status em tempo real
- **WHEN** o operador abre o dashboard de agentes
- **THEN** vê lista com status (online/degradado/offline), última atividade, lag de sync, RPCs/min por agente

### Requirement: Alertas operacionais
Eventos críticos disparam alertas configuráveis (Slack, email, webhook).

#### Scenario: Agente offline por mais de 5 minutos
- **WHEN** um agente fica offline por > 5 min
- **THEN** alerta é emitido para o canal padrão e para o owner do tenant (com opt-out configurável)

#### Scenario: Taxa de erro 5xx sobe acima de 1%
- **WHEN** a taxa de 5xx do backend nos últimos 5 min ultrapassa 1%
- **THEN** alerta é emitido para o time de operação imediatamente

### Requirement: Health check público
Página `status.gmonitor.com.br` mostra disponibilidade dos serviços e histórico de incidentes.

#### Scenario: Página de status reflete saúde real
- **WHEN** um serviço fica indisponível
- **THEN** em até 1 minuto a página exibe degradação correspondente, alimentada por endpoint de saúde interno

### Requirement: Tracing por request
Cada request HTTP gera um `trace_id` propagado em logs e métricas para correlação fim-a-fim.

#### Scenario: Trace cruza fronteiras
- **WHEN** um request da web dispara uma RPC ao agente
- **THEN** o `trace_id` aparece nos logs do backend, da fila e do agente, permitindo seguir o ciclo completo
