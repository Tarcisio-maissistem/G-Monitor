## ADDED Requirements

### Requirement: Sincronização incremental por checkpoint
O agente envia ao SaaS apenas linhas novas ou alteradas desde o último checkpoint, por tabela.

#### Scenario: Primeira sincronização envia base completa
- **WHEN** o agente registra-se pela primeira vez
- **THEN** envia todas as linhas das tabelas operacionais em lotes de 1000, registrando checkpoint após cada lote

#### Scenario: Sync subsequente envia apenas deltas
- **WHEN** o agente já tem checkpoint `last_id=12500` para `VENDAS`
- **THEN** próxima sync envia apenas linhas com `ID > 12500` ordenadas por `ID`

#### Scenario: Falha de upload preserva checkpoint
- **WHEN** o envio de um lote falha
- **THEN** o checkpoint não é avançado e o lote é retentado no próximo tick

### Requirement: Intervalo de sync configurável
O tick de sync padrão é 30s, ajustável por loja e por tipo de dado.

#### Scenario: Loja com muitas vendas pode acelerar
- **WHEN** o owner ativa "sync rápido" para uma loja
- **THEN** o agente passa a tick a cada 10s para tabelas marcadas como `realtime` (vendas, pagamentos)

### Requirement: Idempotência no upsert
A inserção no Postgres SaaS é idempotente: mesmo lote enviado duas vezes não duplica.

#### Scenario: Lote duplicado é absorvido
- **WHEN** o agente reenvia um lote por falha de rede
- **THEN** o backend usa `INSERT ... ON CONFLICT (tenant_id, source_id) DO UPDATE` e o resultado final é idêntico a um único envio

### Requirement: Reconciliação periódica
Uma vez ao dia, o agente compara contagens com o SaaS para detectar divergências.

#### Scenario: Divergência dispara resync parcial
- **WHEN** a contagem do agente para uma tabela difere da contagem no SaaS por mais de 0,1%
- **THEN** o agente recalcula checkpoint e reenviá faixa onde houve divergência

### Requirement: Tabelas sincronizadas no MVP
São sincronizadas: vendas, itens de venda, movimentações de operadores (pagamentos), formas de pagamento (espécies), clientes, produtos, fechamentos de caixa.

#### Scenario: Schema do Postgres replica colunas relevantes
- **WHEN** o backend recebe um lote de `VENDAS`
- **THEN** persiste em tabela `sales` com `tenant_id`, `store_id`, `source_id` (ID Firebird), data, valor, cliente, status

### Requirement: Lag visível ao usuário
O dashboard mostra `staleness_seconds` por loja, baseado no `last_synced_at` de cada tabela.

#### Scenario: Banner amarelo quando lag > 5min
- **WHEN** alguma tabela crítica tem `staleness_seconds > 300`
- **THEN** o frontend exibe alerta visual indicando que os dados podem estar defasados

### Requirement: Backfill de período histórico
O owner pode solicitar reimportação de um período histórico que não foi capturado antes.

#### Scenario: Owner solicita resync dos últimos 90 dias
- **WHEN** o owner aciona "Resync histórico" para uma loja, escolhendo período
- **THEN** o agente envia novamente as linhas do período em segundo plano (sem bloquear sync regular), com indicador de progresso
