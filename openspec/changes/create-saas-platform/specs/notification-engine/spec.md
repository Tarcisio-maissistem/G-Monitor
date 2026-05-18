## ADDED Requirements

### Requirement: Regras de notificação pré-definidas
O sistema oferece regras prontas que o tenant pode ativar e configurar.

#### Scenario: Regras disponíveis no MVP
- **WHEN** o owner abre a tela de notificações
- **THEN** pode ativar: meta diária não batida, queda anômala de vendas vs média móvel 14 dias, ruptura de estoque (produto com saída sem reposição), caixa em divergência no fechamento, inadimplência crítica (parcelas > 90 dias acima de teto), agente offline > 30 min

### Requirement: Avaliação periódica das regras
Um worker avalia regras ativas em intervalo configurável (5min por padrão).

#### Scenario: Worker processa todas as regras ativas
- **WHEN** o tick do worker dispara
- **THEN** lê regras ativas, calcula condição contra dados sincronizados ou agente quando necessário, e emite notificações cujo cooldown está vencido

#### Scenario: Cooldown evita spam
- **WHEN** uma regra dispara, fica em cooldown configurável (default 4h)
- **THEN** novas avaliações da mesma regra durante o cooldown não geram nova notificação

### Requirement: Canais de entrega
Notificações são entregues por dois canais: in-app e email. WhatsApp e webhook ficam como roadmap.

#### Scenario: Notificação in-app fica visível
- **WHEN** uma notificação é gerada para o usuário
- **THEN** aparece em sino do app com contador, com data de criação e link para a tela relevante

#### Scenario: Notificação por email respeita preferência
- **WHEN** o usuário desativou email para esse tipo
- **THEN** apenas o canal in-app é usado

### Requirement: Preferências por usuário
Cada usuário escolhe quais tipos receber em quais canais.

#### Scenario: Usuário silencia tipo específico
- **WHEN** o usuário marca "meta diária" como "não receber email"
- **THEN** notificações desse tipo só aparecem in-app para esse usuário

### Requirement: Notificações respeitam papéis
Apenas usuários com escopo apropriado recebem cada notificação.

#### Scenario: Operador só recebe alertas da sua loja
- **WHEN** uma regra dispara para a loja X
- **THEN** apenas owners, admins, gestores e operadores vinculados à loja X recebem

### Requirement: Histórico de notificações
O sistema mantém histórico das notificações geradas para auditoria e diagnóstico.

#### Scenario: Owner consulta histórico
- **WHEN** o owner abre histórico
- **THEN** vê últimas 200 notificações com tipo, regra disparadora, valor que disparou, data, destinatários

### Requirement: Modo agente offline gera alerta
Quando o agente fica offline por mais de 30 minutos, owner e admins do tenant recebem alerta.

#### Scenario: Agente cai de noite e volta de manhã
- **WHEN** o agente fica 45min offline
- **THEN** uma notificação é gerada às 30min e uma de "reconectado" quando volta, ambas com data/hora
