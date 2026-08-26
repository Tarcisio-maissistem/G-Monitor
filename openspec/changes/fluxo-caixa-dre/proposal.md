# Fluxo de Caixa + DRE + reorganização mobile-first

**Status:** APROVADO pelo dono (Tarcísio) em 25/08/2026 — opção 2 (MVP), 3 decisões de produto tomadas.

## Problema

O G-Monitor já sincroniza vendas (VENDAS), pagamentos recebidos (MOV_OPERADORES), itens de venda
(ITEVENDAS) e contas a pagar/receber (PAGAR/RECEBER) do GDOOR, mas:

1. **Não existe Fluxo de Caixa.** As telas Caixa e Caixa Detalhado mostram `saida: 0` hardcoded
   (`reports/routes.ts`) — não é caixa zerado, é dado que nunca foi montado.
2. **O "DRE simplificado" atual está errado.** Subtrai cancelamentos da receita bruta que já não
   os inclui; não tem despesas, CMV, nada além de receita.
3. **Componentes de dashboard prontos chamam endpoints que não existem** (FluxoCaixaChart,
   CashflowForecast, PlanoContasCard, HeroCards — resgatados 23/08, nunca ligados).
4. **No celular quase toda tela rola de lado.** Só ContasPagar/ContasReceber/FinanceCalendar têm
   padrão de card mobile; as outras 19 usam `<table>` larga com `overflow-x-auto`.

Dono de loja usa isso no celular, no balcão. O produto é o celular; desktop é secundário.

## Objetivo

Entregar **Fluxo de Caixa (realizado + projetado)** e **DRE** que sejam honestos com o dado que
existe — cada linha com selo `real / estimativa / N/D`, nunca zero escondendo dado que falta — e
nascerem **mobile-first**, junto com um kit mínimo de componentes compartilhados que as demais
telas usam nas ondas seguintes.

## O que dá pra fazer com o dado que JÁ existe (sem mexer no agente)

- **Fluxo realizado por dia:** entradas = pagamentos de venda (dinheiro/cartão/pix) + crediário
  recebido (baixa em RECEBER) + pagamentos avulsos (sem venda vinculada — marcados como estimativa);
  saídas = contas a pagar baixadas (PAGAR.PAGAMENTO). Resultado = variação do período (nunca
  "saldo em caixa" — não há saldo inicial).
- **Fluxo projetado (7/15/30/60/90 dias):** RECEBER e PAGAR em aberto por vencimento + bloco
  "vencidos". 100% real.
- **DRE v1:** receita bruta (real), despesas pagas (real, regime caixa ou por vencimento),
  resultado (estimativa), composição por forma de pagamento (real), despesas por fornecedor
  (real). Descontos, devoluções, CMV, impostos, categoria de despesa = **N/D** até o agente
  sincronizar produto/custo/plano de contas.

## Decisões de produto (dono, 25/08)

| # | Decisão | Consequência no código |
|---|---------|------------------------|
| P1 | **Crediário entra no caixa só quando o título é baixado** (RECEBER.RECEBIMENTO), não na data da venda | `Payment` com tipo crediário é EXCLUÍDO do fluxo realizado; entra via `Receivable.receivedDate`. Evita contar 2x. |
| P2 | **Pré-venda (PV), NFC-e (65) e NF-e (55) contam TODAS como venda.** "Toda prevenda é registrada como venda; o recebimento pode ser no PDV (entra no fechamento do caixa) ou no retaguarda." | Receita bruta = `Sale.cancelled=false`, **sem** filtrar `processed`. Naturezas `Devolução%` e `Complementar%` ficam fora da receita (não são venda) e aparecem no memo. |
| P3 | **Liberar ao cliente com selo "estimativa / N/D" visível** (não segurar até ter CMV e sangria) | UI mostra `DataQualityBanner` + badge por linha; "X de 8 linhas com dado real". A palavra "lucro" não aparece — é "resultado aproximado". |

## Achados da Fase 0 (queries na produção, 25/08)

- **Formas de pagamento reais** (literais em `payments.paymentType`, com mojibake herdado de
  antes do charsetPatch): `CARTãO CRéDITO` (3955, R$348k), `DINHEIRO` (1869 + 125 avulsos =
  R$60k sem venda), `A PRAZO / CRéDITO LOJA` (572, R$159k — crediário), `PAGAMENTO INSTANTâNEO
  (PIX)` (1068, R$119k), `CARTãO DA LOJA, CREDIáRIO DIGITAL, OUTROS CREDIáRIOS` (518, R$26k —
  crediário), `OUTRAS` (79), `SEM PAGAMENTO` (1). O `TYPE_MAP` atual (`DINHEIRO/CARTAO/PIX/
  CREDIARIO` exatos) **não bate com nenhum literal de cartão/pix/crediário** — tudo caía em
  "outros". Novo mapa por `LIKE` normalizado (sem acento).
- **Fuso: sem problema.** 100% das datas (sales, payments, payables, receivables) estão em
  `03:00Z` = coluna DATE no GDOOR, só dia. `date_trunc('day')` em UTC agrupa certo.
- **125 pagamentos DINHEIRO com `saleId` NULL (R$60k)** — consistente com "recebimento de crediário
  no PDV" (P2). Entram no fluxo como linha `avulsos` com status `estimate`.
- **Naturezas em `sales`:** `Venda a Vista` (maioria, PV+65), `Venda a vista` (55), `Complementar`
  (55, 11 linhas), `Devolução de compra para comercialização` (55, 5 linhas), `Venda com
  substituição tributária` (65, 3), `Venda a prazo` (55, 1), `null` (PV/65 zerados). `processed=false`
  existe (~1.5k linhas) — conta como venda por P2.

## Fora de escopo (backlog, ver design.md)

Sync de produto/custo (CMV), sangria/suprimento (MOV_OPERADORES direção), fechamento de caixa,
categoria/plano de contas do PAGAR, baixas parciais, descontos/devoluções, bottom nav. Cada um
exige release do agente em cada loja e/ou acesso ao Firebird real pra confirmar coluna.

## Ondas seguintes (orçadas à parte, ~18h)

- Onda 2 financeiro: ContasPagar/Receber nos componentes novos, Pagamentos, FechamentoMensal,
  MovimentoCaixa com saídas (merge paginado).
- Onda 3 operacional: Vendas, Relatórios, Comissão, MetaMensal.
- Onda 4 admin: Empresas/Usuários/Lojas/PDVs + rotas quebradas.
