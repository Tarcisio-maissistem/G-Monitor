## ADDED Requirements

### Requirement: Handshake autenticado por token de agente
O agente se autentica no SaaS apresentando um token único do tenant/loja na abertura da conexão WebSocket.

#### Scenario: Token válido abre sessão
- **WHEN** o agente conecta a `wss://ws.gmonitor.com.br/agent` enviando header `Authorization: Bearer agt_<tenantId>_<uuid>_<secret>`
- **THEN** o SaaS valida o token, cria registro `agent_session` com `connected_at` e responde com `agent_session_id` e versão de protocolo

#### Scenario: Token inválido ou revogado fecha conexão
- **WHEN** o token não existe, foi revogado ou expirou
- **THEN** o SaaS fecha o WebSocket com código 4401 e a razão é registrada em audit_log sem detalhes vazados ao cliente

### Requirement: Conexão WebSocket persistente outbound
O agente nunca abre porta; toda comunicação é iniciada pelo agente como cliente WebSocket TLS.

#### Scenario: Agente atravessa NAT/firewall corporativo
- **WHEN** a loja tem firewall que bloqueia portas de entrada
- **THEN** o agente conecta normalmente porque usa apenas porta 443 saída (TLS), igual a um navegador

### Requirement: Heartbeat e detecção de queda
O canal mantém ping/pong para detectar conexões mortas rapidamente.

#### Scenario: Ping a cada 25 segundos
- **WHEN** a conexão está estabelecida
- **THEN** o agente envia `ping` a cada 25s e espera `pong` em até 5s

#### Scenario: 60 segundos sem pong derruba a sessão
- **WHEN** não há pong em 60s
- **THEN** o agente fecha o socket, marca sessão como suspeita e inicia reconexão; o SaaS marca `agent_session.disconnected_at`

### Requirement: Reconexão com backoff exponencial e jitter
Após queda, o agente reconecta com espera crescente e aleatorizada para evitar tempestade.

#### Scenario: Backoff 1s → 2s → 4s ... até 60s
- **WHEN** a reconexão falha
- **THEN** a próxima tentativa espera o dobro do tempo anterior, limitado a 60s, com jitter de ±20%

#### Scenario: Reconexão bem-sucedida zera o backoff
- **WHEN** o agente reconecta com sucesso
- **THEN** o contador volta a 1s

### Requirement: Versionamento de protocolo
Cliente e servidor declaram versão de protocolo no handshake e negociam compatibilidade.

#### Scenario: Versões compatíveis prosseguem
- **WHEN** o agente declara `protocol_version=1.x` e o servidor suporta a major 1
- **THEN** a sessão prossegue normalmente

#### Scenario: Major incompatível força update
- **WHEN** o servidor exige major superior à do agente
- **THEN** o servidor fecha a conexão com código `protocol_outdated` e o agente entra em modo "atualização obrigatória", buscando nova versão antes de reconectar

### Requirement: Rotação remota de token de agente
O owner pode rotacionar o token de um agente sem desinstalar; o agente recebe o novo token via RPC, valida, persiste e reconecta.

#### Scenario: Owner rotaciona token via painel
- **WHEN** o owner clica em "Rotacionar token" para uma loja
- **THEN** o SaaS gera novo token, envia ao agente via RPC `rotateToken`, marca o antigo como revogado em 5 minutos para janela de transição

#### Scenario: Token comprometido pode ser revogado imediatamente
- **WHEN** o owner aciona "Revogar agora"
- **THEN** o antigo é revogado instantaneamente, a sessão atual é encerrada e o agente fica offline até receber novo token por canal manual (re-instalação ou comando de suporte)

### Requirement: Sessão única por agente
Apenas uma sessão WebSocket por agente é ativa ao mesmo tempo.

#### Scenario: Nova conexão derruba antiga
- **WHEN** um agente já conectado abre nova conexão (por exemplo após reboot)
- **THEN** a antiga é encerrada com código `replaced_by_new_session`, evitando duplicidade de RPCs
