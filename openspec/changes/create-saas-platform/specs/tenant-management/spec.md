## ADDED Requirements

### Requirement: Cadastro de tenant
O sistema permite que um novo cliente crie uma conta de tenant fornecendo dados da empresa e do usuário owner inicial.

#### Scenario: Cadastro válido cria tenant ativo
- **WHEN** um visitante envia nome da empresa, CNPJ válido, email e senha
- **THEN** um novo tenant é criado com status `active`, um usuário owner é criado vinculado a esse tenant, e o owner recebe email de boas-vindas

#### Scenario: CNPJ duplicado é rejeitado
- **WHEN** o CNPJ informado já pertence a outro tenant
- **THEN** o cadastro é rejeitado com mensagem clara, sem revelar a quem pertence

### Requirement: Isolamento entre tenants
Nenhum dado de um tenant é acessível por usuários, agentes ou queries de outro tenant.

#### Scenario: Usuário do tenant A não vê dados do tenant B
- **WHEN** um usuário autenticado do tenant A solicita qualquer endpoint que liste recursos
- **THEN** apenas recursos cujo `tenant_id` corresponde ao tenant do usuário são retornados, mesmo que IDs de outros tenants sejam informados explicitamente

#### Scenario: Tentativa cruzada por ID retorna 404
- **WHEN** um usuário do tenant A solicita um recurso por ID que pertence ao tenant B
- **THEN** o sistema responde 404, sem distinguir entre inexistente e proibido

### Requirement: Cadastro de lojas do tenant
Cada tenant pode cadastrar uma ou mais lojas, cada loja tem identificação única e configuração própria.

#### Scenario: Owner cria loja
- **WHEN** o owner envia nome, identificador interno e fuso horário
- **THEN** a loja é criada associada ao tenant e disponível para vincular um agente

#### Scenario: Cada loja aceita no máximo um agente ativo
- **WHEN** um segundo agente tenta se registrar para uma loja que já tem agente ativo
- **THEN** o registro é rejeitado a menos que o token anterior tenha sido explicitamente revogado

### Requirement: Configuração por tenant
O tenant configura nome fantasia, logo, fuso padrão, moeda, metas e taxas que afetam todos os relatórios.

#### Scenario: Owner atualiza meta mensal
- **WHEN** o owner envia novo valor de meta mensal
- **THEN** o valor é persistido, registrado em audit_log e aparece imediatamente nos dashboards

### Requirement: Suspensão e exclusão de tenant
O sistema suporta suspensão (acesso bloqueado, dados preservados) e exclusão definitiva (LGPD: anonimização irreversível em até 30 dias).

#### Scenario: Tenant suspenso por inadimplência
- **WHEN** a assinatura entra em `past_due` por mais de 7 dias
- **THEN** o tenant é marcado como `suspended`, todos os logins são bloqueados, agente recebe ordem de desconectar, dados ficam preservados

#### Scenario: Solicitação de exclusão definitiva
- **WHEN** o owner solicita exclusão definitiva por escrito (suporte ou autoatendimento autenticado)
- **THEN** o tenant entra em estado `pending_deletion`, todos os PII são anonimizados, registros operacionais agregados (sem PII) podem ser retidos por obrigação fiscal por até 5 anos
