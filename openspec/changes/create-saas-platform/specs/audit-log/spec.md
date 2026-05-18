## ADDED Requirements

### Requirement: Registro de ações sensíveis
Toda ação sensível é registrada com ator, alvo, valor antes e depois, IP e user agent.

#### Scenario: Mudança de meta é auditada
- **WHEN** um owner altera a meta mensal
- **THEN** um registro é criado em `audit_logs` com `actor_id`, `action=tenant.meta.updated`, `before`, `after`, `ip`, `user_agent`, `created_at`

#### Scenario: Convite de usuário é auditado
- **WHEN** um admin convida novo usuário
- **THEN** registro é criado com `action=user.invited`, `before=null`, `after={email, role}`

### Requirement: Ações auditadas no MVP
São auditadas no mínimo: login, logout, falha de login, mudança de papel, criação/exclusão de usuário, criação/exclusão de loja, rotação/revogação de token de agente, alteração de meta e taxa, alteração de configuração de tenant, mudança de plano, exclusão de tenant.

#### Scenario: Falha de login é registrada
- **WHEN** um login falha
- **THEN** registro com `action=auth.login.failed`, `actor_id=null`, contendo o email tentado, IP e UA

### Requirement: Visualização para owner e admin
Owners e admins podem consultar o audit log do próprio tenant.

#### Scenario: Filtros por entidade, ator e período
- **WHEN** o owner acessa `/api/audit?entity=user&from=2026-01-01&to=2026-05-17`
- **THEN** vê apenas registros que afetam usuários, no período solicitado, paginados

#### Scenario: Outros papéis não acessam
- **WHEN** um gestor solicita `/api/audit`
- **THEN** a resposta é 403

### Requirement: Imutabilidade dos registros
Registros de audit log não podem ser alterados nem deletados via API.

#### Scenario: Nenhum endpoint permite edição
- **WHEN** um usuário tenta `PATCH` ou `DELETE` em `/api/audit/:id`
- **THEN** a resposta é 405 e o evento é registrado em meta-audit

### Requirement: Retenção e arquivamento
Registros são mantidos online por 2 anos; depois são movidos para armazenamento frio.

#### Scenario: Registros > 2 anos movem para frio
- **WHEN** o job mensal de retenção roda
- **THEN** registros com `created_at < hoje - 2 anos` são exportados para storage frio (S3/B2 com lifecycle) e removidos da tabela quente

#### Scenario: Solicitação LGPD inclui histórico até retenção
- **WHEN** um titular solicita seus dados
- **THEN** o sistema entrega o que está online; histórico frio é entregue em até 15 dias úteis

### Requirement: Exportação em CSV
Owners podem exportar o log em CSV para arquivo externo.

#### Scenario: Owner exporta período
- **WHEN** o owner solicita exportação de um período de até 12 meses
- **THEN** um arquivo CSV é gerado e disponibilizado para download via link assinado expirando em 1 hora
