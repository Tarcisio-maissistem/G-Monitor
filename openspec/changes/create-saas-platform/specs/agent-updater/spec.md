## ADDED Requirements

### Requirement: Canais de release
Releases do agente seguem três canais: `stable`, `beta`, `canary`.

#### Scenario: Tenant escolhe canal
- **WHEN** o owner define o canal de release para sua organização
- **THEN** todos os agentes desse tenant passam a buscar updates do canal selecionado

### Requirement: Endpoint de release autenticado
O agente consulta o SaaS para saber se há nova versão, incluindo hash SHA-256 e URL assinada.

#### Scenario: Agente consulta a cada hora
- **WHEN** o agente está conectado
- **THEN** a cada 60min envia RPC `checkUpdate` com versão atual e plataforma, recebendo `{available: bool, version, downloadUrl, sha256, signature}`

### Requirement: Verificação criptográfica do binário
O agente só executa novo binário após verificar hash e assinatura Ed25519 com chave pública embarcada.

#### Scenario: Hash incorreto cancela update
- **WHEN** o hash baixado não confere
- **THEN** o arquivo é descartado, evento é logado e nova tentativa só ocorre no próximo ciclo

#### Scenario: Assinatura inválida cancela update
- **WHEN** a assinatura Ed25519 não bate com a chave pública embarcada
- **THEN** o binário é descartado e alerta de segurança é enviado ao backend

### Requirement: Instalação atômica com rollback
A troca de versão é atômica e suporta rollback automático em caso de falha pós-update.

#### Scenario: Nova versão é instalada lado-a-lado
- **WHEN** a verificação passa
- **THEN** o agente baixa para `%PROGRAMDATA%\GMonitor\bin\<version>\`, atualiza symlink/junction `current`, reinicia o serviço

#### Scenario: Três health checks consecutivos falhos disparam rollback
- **WHEN** após o restart, 3 health checks consecutivos falham nos primeiros 5min
- **THEN** o symlink reverte para a versão anterior e o serviço reinicia automaticamente

### Requirement: Rollout em ondas
Releases novas são distribuídas progressivamente para reduzir blast radius.

#### Scenario: Canary recebe primeiro
- **WHEN** uma versão é promovida a `canary`
- **THEN** apenas 5% dos agentes do canal recebem nas primeiras 24h, 25% nas próximas 24h, 100% no terceiro dia, se métricas estiverem saudáveis

#### Scenario: Métricas ruins pausam o rollout
- **WHEN** a taxa de erro dos agentes na nova versão excede 2× a versão anterior
- **THEN** o rollout é pausado automaticamente e o time de operação é notificado

### Requirement: Forçar update por owner
O owner pode forçar update imediato para sua organização.

#### Scenario: Botão "atualizar agora"
- **WHEN** o owner aciona o botão
- **THEN** o backend envia RPC `forceUpdate` aos agentes do tenant, ignorando agendamento

### Requirement: Janela de manutenção configurável
O tenant pode definir janela noturna em que o agente prefere instalar updates.

#### Scenario: Update agendado para 02:00
- **WHEN** uma nova versão está disponível e o tenant tem janela 02:00–04:00 BRT
- **THEN** o agente posterga a instalação para essa janela, exceto updates críticos de segurança
