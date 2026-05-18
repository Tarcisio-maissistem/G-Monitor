## ADDED Requirements

### Requirement: Driver Firebird nativo
O agente conecta ao Firebird usando driver nativo de protocolo TCP, não spawn de `isql.exe`.

#### Scenario: Conexão local usa pool persistente
- **WHEN** o agente inicia
- **THEN** abre um pool de 5 conexões TCP ao Firebird local (`localhost:3050`), reaproveitadas entre RPCs

#### Scenario: Pool reconecta em queda do banco
- **WHEN** uma conexão do pool falha
- **THEN** é descartada, uma nova é criada sob demanda e a operação é retentada uma única vez

### Requirement: Detecção automática do Firebird instalado
O agente descobre versão, caminho do executável e caminho do `.fdb` sem configuração manual obrigatória.

#### Scenario: Instalação padrão é detectada
- **WHEN** Firebird 2.5 / 3.0 / 4.0 / 5.0 está em caminho padrão (`C:\Program Files\Firebird\...` ou `Program Files (x86)`)
- **THEN** o agente identifica versão e caminho no boot e registra em log

#### Scenario: Caminho não-padrão pode ser configurado
- **WHEN** o cliente tem instalação customizada
- **THEN** o agente lê configuração local (`%PROGRAMDATA%\GMonitor\agent.json`) com chave `firebird.fdbPath` e `firebird.binPath`

#### Scenario: Falha de detecção entra em modo aviso
- **WHEN** nada é encontrado
- **THEN** o agente conecta ao SaaS mesmo assim, marca status `firebird_not_found` e exibe alerta para o owner ajustar configuração

### Requirement: Credenciais de banco protegidas no disco
Usuário e senha do Firebird são armazenados criptografados no disco local do agente.

#### Scenario: Credenciais cifradas com chave derivada do token
- **WHEN** o instalador configura credenciais
- **THEN** elas são gravadas em `agent.json` criptografadas com AES-256-GCM usando chave derivada do token do agente

#### Scenario: Logs nunca contêm senha
- **WHEN** o agente loga conexão ou erro
- **THEN** a senha é redacted (`***`) e o usuário só aparece se nível de log for `debug`

### Requirement: Queries usam prepared statements
Todas as queries do catálogo são preparadas pelo driver com parâmetros separados.

#### Scenario: Mesma query preparada é reutilizada
- **WHEN** uma query é executada repetidamente
- **THEN** o agente reaproveita o statement preparado por conexão, reduzindo parsing no Firebird

### Requirement: Suporte a múltiplas versões do Firebird
O agente funciona com Firebird 2.5, 3.0, 4.0 e 5.0.

#### Scenario: Versão antiga sem features modernas usa fallback
- **WHEN** uma query depende de feature do Firebird 3.0+ (ex: BOOLEAN, window functions) e o cliente roda 2.5
- **THEN** o catálogo expõe variante alternativa marcada por `min_version` e o agente seleciona automaticamente

### Requirement: Tratamento de codificação
O agente lê o charset do banco e converte resultados para UTF-8 antes de enviar ao SaaS.

#### Scenario: Banco WIN1252 é traduzido para UTF-8
- **WHEN** o `.fdb` foi criado com charset `WIN1252` e contém acentos
- **THEN** as strings retornadas chegam ao SaaS em UTF-8 íntegro, sem `?` ou mojibake

### Requirement: Validação de saúde do banco
O agente verifica saúde do Firebird periodicamente e reporta status ao SaaS.

#### Scenario: Health check a cada minuto
- **WHEN** o agente está conectado ao SaaS
- **THEN** a cada 60s executa `SELECT 1 FROM RDB$DATABASE`, registra tempo de resposta e reporta status
