## ADDED Requirements

### Requirement: Roteamento por tenant e loja
O backend SaaS roteia cada RPC para o agente correto com base em `tenant_id` e `store_id` extraídos da sessão autenticada.

#### Scenario: Request de usuário toca agente da própria loja
- **WHEN** um usuário do tenant A solicita relatório em tempo real para a loja X
- **THEN** o backend resolve o agente conectado para (tenant=A, store=X) e despacha a RPC

#### Scenario: Loja sem agente registrado retorna 503
- **WHEN** não há agente conectado para a loja solicitada
- **THEN** o backend responde 503 com indicação "agente offline" e oferece os últimos dados sincronizados se disponíveis

### Requirement: Registry de conexões agente
O backend mantém um registro em Redis associando `agent_id` à instância de backend que detém a conexão WebSocket.

#### Scenario: Registry permite múltiplas instâncias do backend
- **WHEN** existem 3 instâncias do backend rodando atrás de um load balancer
- **THEN** uma RPC originada na instância 1 para um agente conectado à instância 3 é enrutada via pub/sub Redis para a instância correta

### Requirement: Fila com correlação de resposta
Cada RPC tem `request_id` único e o backend aguarda a resposta correlacionada com timeout.

#### Scenario: Resposta chega dentro do timeout
- **WHEN** o agente responde dentro de 30s (ou outro limite por op)
- **THEN** o backend entrega o resultado ao chamador HTTP

#### Scenario: Timeout libera recurso e retorna erro
- **WHEN** o agente não responde dentro do limite
- **THEN** o backend libera o slot pendente, registra métrica de timeout e retorna 504 ao chamador

### Requirement: Fallback degradado por snapshot
Quando o agente está offline ou não responde, o backend serve a versão mais recente disponível dos dados sincronizados, indicando que estão defasados.

#### Scenario: Dashboard mostra dados de cache com aviso
- **WHEN** o usuário abre uma tela cujo dado existe no Postgres SaaS (sincronizado)
- **THEN** a resposta inclui `staleness_seconds` e `agent_online: false`, e o frontend exibe banner correspondente

### Requirement: Distribuição justa entre lojas
Uma loja com muitas RPCs pendentes não impede outras lojas do mesmo tenant de serem atendidas.

#### Scenario: Fila por agente
- **WHEN** o agente da loja X está saturado com 10 RPCs
- **THEN** as RPCs para o agente da loja Y são processadas normalmente, em fila separada

### Requirement: Métricas de roteamento
O backend exporta métricas Prometheus de latência e taxa por operação e por agente.

#### Scenario: Latência alta dispara alerta
- **WHEN** a métrica `agent_rpc_latency_seconds` para um agente passa de p95 > 5s por 10 min
- **THEN** alerta é emitido no Grafana e visível ao time de operação
