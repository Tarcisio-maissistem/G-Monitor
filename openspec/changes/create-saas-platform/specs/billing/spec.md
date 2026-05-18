## ADDED Requirements

### Requirement: Planos com limites
A plataforma oferece planos com limites de lojas, usuários e relatórios premium.

#### Scenario: Plano inicial limita 1 loja e 3 usuários
- **WHEN** o tenant está no plano `starter`
- **THEN** a criação de uma segunda loja é bloqueada com mensagem oferecendo upgrade

#### Scenario: Plano business permite múltiplas lojas
- **WHEN** o tenant está no plano `business`
- **THEN** pode criar até 10 lojas e 20 usuários, com relatórios avançados liberados

### Requirement: Checkout via Stripe
Novas assinaturas e mudanças de plano usam Stripe Checkout.

#### Scenario: Owner contrata plano
- **WHEN** o owner clica em "Contratar"
- **THEN** é redirecionado para Stripe Checkout pré-configurado com plano selecionado e retorna ao app após pagamento

### Requirement: Portal de cliente Stripe
Atualização de cartão, troca de plano e download de notas usam o Stripe Customer Portal.

#### Scenario: Owner acessa portal
- **WHEN** o owner clica em "Gerenciar pagamento"
- **THEN** é direcionado ao portal hospedado pela Stripe com sessão autenticada

### Requirement: Webhook de eventos de pagamento
O backend processa webhooks Stripe para refletir estado da assinatura.

#### Scenario: Webhook atualiza status
- **WHEN** Stripe emite `customer.subscription.updated`
- **THEN** o backend atualiza `subscriptions.status` no Postgres e invalida cache de plano em até 1 minuto

#### Scenario: Webhook com assinatura inválida é rejeitado
- **WHEN** a assinatura HMAC do webhook não bate
- **THEN** o backend responde 400 e o evento não é processado

### Requirement: Reconciliação periódica
Um job horário verifica diretamente na API Stripe o estado das assinaturas, prevenindo divergência por webhook perdido.

#### Scenario: Estado diverge e é corrigido
- **WHEN** Stripe reporta `active` mas o banco mostra `past_due`
- **THEN** o banco é atualizado para `active`, evento é logado

### Requirement: Bloqueio gradual por inadimplência
Inadimplência leva a degradação antes do bloqueio total.

#### Scenario: Dia 1 a 3 após falha — aviso
- **WHEN** o pagamento falha
- **THEN** o owner recebe email diário e banner aparece no app, mas acesso continua pleno

#### Scenario: Dia 4 a 7 — modo somente leitura
- **WHEN** o pagamento permanece falho
- **THEN** ações de escrita (criar relatórios agendados, convidar usuários) são bloqueadas; leitura continua

#### Scenario: Após dia 7 — bloqueio
- **WHEN** o pagamento permanece falho
- **THEN** o tenant é marcado `suspended`, agentes recebem ordem de desconectar, dados são preservados por mais 30 dias para recuperação

### Requirement: Emails transacionais de cobrança
Emails padronizados são enviados em eventos relevantes.

#### Scenario: Emails de boas-vindas e fatura
- **WHEN** o tenant contrata plano
- **THEN** recebe email de boas-vindas; a cada cobrança, recebe email com link da nota; em caso de falha, recebe email com instrução de regularização
