## ADDED Requirements

### Requirement: Catálogo mínimo de relatórios
O MVP inclui os seguintes relatórios pré-definidos disponíveis a todos os tenants ativos.

#### Scenario: Lista de relatórios disponíveis
- **WHEN** um usuário autenticado solicita `/api/reports`
- **THEN** retorna a lista: vendas resumo, vendas por forma de pagamento, curva ABC de produtos, DRE simplificado, ruptura de estoque, inadimplência (aging 30/60/90/90+), comissão por operador, cohort de clientes

### Requirement: Filtros padrão por período e loja
Todos os relatórios aceitam parâmetros de período (`from`, `to`) e filtro por loja (`store_id` ou "todas").

#### Scenario: Período padrão é últimos 30 dias
- **WHEN** o usuário não envia `from` e `to`
- **THEN** o backend assume `to=hoje` e `from=hoje-30`

#### Scenario: Operador não pode pedir "todas as lojas"
- **WHEN** um usuário operador solicita relatório com `store_id=all`
- **THEN** o backend força `store_id` para a loja vinculada do operador

### Requirement: Resposta inclui metadados de freshness
Cada relatório indica quando os dados foram sincronizados pela última vez e se algum agente está offline.

#### Scenario: Resposta contém staleness
- **WHEN** o backend monta a resposta de qualquer relatório
- **THEN** inclui campos `last_synced_at`, `staleness_seconds`, `agents_offline: []`

### Requirement: Exportação CSV e XLSX
Relatórios podem ser exportados em CSV e XLSX preservando filtros aplicados.

#### Scenario: Exportação assíncrona para grandes volumes
- **WHEN** o resultado tem mais de 50 mil linhas
- **THEN** o backend agenda job, retorna `export_id` e o usuário recebe email com link assinado quando pronto

### Requirement: Cache adaptativo
Relatórios cujo período termina antes de hoje têm TTL longo (1 hora); relatórios incluindo hoje têm TTL curto (30s).

#### Scenario: Cache de histórico é longo
- **WHEN** o filtro é `from=2026-01-01&to=2026-01-31` e hoje é 2026-05-17
- **THEN** o resultado é cacheado em Redis por até 1 hora

#### Scenario: Cache de hoje é curto
- **WHEN** o filtro inclui `to >= hoje`
- **THEN** o cache é de no máximo 30s para refletir mudanças recentes

### Requirement: DRE simplificado
O relatório DRE consolida receita (vendas líquidas), custo de mercadoria vendida (CMV), despesas operacionais e resultado líquido.

#### Scenario: Cálculo de margem
- **WHEN** o usuário abre o DRE para o mês
- **THEN** o sistema apresenta receita bruta, descontos, devoluções, receita líquida, CMV, margem bruta, despesas, resultado, ambas em valor e % da receita

### Requirement: Curva ABC
A curva ABC classifica produtos em três faixas (A: 80% do valor, B: 15%, C: 5%) por venda ou margem.

#### Scenario: Faixa ABC visível na lista
- **WHEN** o usuário abre curva ABC por valor de venda
- **THEN** cada produto mostra valor acumulado, % acumulado e classificação A/B/C

### Requirement: Inadimplência com aging
A inadimplência mostra parcelas em aberto agrupadas por faixa: 0–30, 31–60, 61–90, 90+ dias.

#### Scenario: Faixas calculadas a partir da data de vencimento
- **WHEN** o usuário abre o relatório
- **THEN** cada parcela aparece em apenas uma faixa com base em (hoje - data_vencimento), e totais por faixa são exibidos
