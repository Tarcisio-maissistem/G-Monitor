## ADDED Requirements

### Requirement: Contratos RPC tipados
Toda chamada RPC entre SaaS e agente segue um contrato com nome de operação e schema de parâmetros e resposta declarado em código.

#### Scenario: Chamada com parâmetro inválido é rejeitada antes de execução
- **WHEN** o SaaS envia `{op: "executeQuery", params: {sqlId: 42}}` mas o contrato exige `sqlId` string
- **THEN** o agente responde com erro `invalid_params` e nada é executado no Firebird

### Requirement: Catálogo de queries no agente
O agente só executa SQL listado em catálogo pré-aprovado; o SaaS envia identificador de query, não SQL bruto.

#### Scenario: Identificador de query inexistente é rejeitado
- **WHEN** o SaaS envia `{op: "runReport", params: {reportId: "queryNaoExiste"}}`
- **THEN** o agente responde `report_not_found` e o evento é registrado para investigação

#### Scenario: Catálogo é assinado e versionado
- **WHEN** o agente inicializa
- **THEN** carrega catálogo local, verifica assinatura Ed25519 com chave pública embarcada, recusa execução se assinatura inválida

### Requirement: Parâmetros sempre por placeholder
Queries no catálogo usam placeholders `?` e o agente passa parâmetros ao driver, nunca concatena strings.

#### Scenario: Tentativa de injeção em parâmetro é tratada como string literal
- **WHEN** um relatório recebe parâmetro `data = "'; DROP TABLE VENDAS; --"`
- **THEN** o driver Firebird trata como string literal e a query falha por tipo inválido ou retorna vazio, sem afetar o banco

### Requirement: Timeout por operação
Cada operação tem timeout máximo; após esgotar, a chamada é cancelada e o agente responde com erro.

#### Scenario: Query lenta é abortada em 30 segundos
- **WHEN** uma query excede 30s (default) ou o limite específico da op
- **THEN** o agente cancela a query no driver, libera a conexão e responde `timeout`

### Requirement: Backpressure por agente
O agente recusa novas RPCs quando há excesso de operações pendentes para evitar OOM.

#### Scenario: Décima primeira RPC simultânea é recusada
- **WHEN** já existem 10 RPCs em execução e uma nova chega
- **THEN** o agente responde `too_busy` com `retry_after` em segundos

### Requirement: Operações suportadas no MVP
O catálogo inicial inclui as operações: `ping`, `executeQuery` (interno), `getSchema`, `runReport`, `syncTick`, `syncBatch`, `rotateToken`, `updateCatalog`, `getAgentInfo`.

#### Scenario: ping responde imediatamente
- **WHEN** o SaaS envia `ping` com `nonce`
- **THEN** o agente responde com o mesmo `nonce` e seu uptime em segundos, em menos de 100ms

#### Scenario: getAgentInfo retorna versão e ambiente
- **WHEN** o SaaS solicita `getAgentInfo`
- **THEN** o agente retorna versão do agente, versão do Firebird detectada, caminho do `.fdb`, sistema operacional e contadores básicos

### Requirement: Resposta inclui correlation id
Toda resposta carrega o `request_id` da chamada original para correlação em logs.

#### Scenario: Logs correlacionam request e response
- **WHEN** uma RPC é despachada com `request_id=abc123`
- **THEN** o log da chamada e da resposta contêm o mesmo `request_id` e o lag agente↔SaaS é mensurável
