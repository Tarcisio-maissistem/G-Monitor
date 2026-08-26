# Design — Fluxo de Caixa + DRE + kit mobile-first

Contexto e decisões de produto: `proposal.md`. Fatos verificados no código (66 KB, por arquivo/linha)
ficaram no scratchpad da sessão de 25/08 e estão resumidos onde relevante abaixo.

## D16. Fluxo de Caixa v1 — só dado já sincronizado, honesto sobre o que falta

**Módulo novo** `apps/backend/src/reports/cashflow.ts` com `buildCashflow(tenantId, storeId, from, to)`
(função interna reusada por `/cashflow` e `/cash-detailed`). 3 `$queryRaw` agregando por
`date_trunc('day', ...)` em UTC (Fase 0 confirmou: todas as datas são `03:00Z` = DATE, sem hora):

| Fonte | Regra | Status na resposta |
|-------|-------|--------------------|
| `payments` LEFT JOIN `sales` ON `payments.saleId = sales.id` | `sales.id IS NULL OR sales.cancelled = false`; **exclui crediário** (P1); agrupa por forma normalizada | `real` |
| `payments` com `saleId IS NULL` | linha própria `avulsos` (125 linhas DINHEIRO na prod = provável recebimento de crediário no PDV, P2) | `estimate` |
| `receivables` | `receivedValue > 0 AND cancelled = false`, por `receivedDate` = crediário recebido (P1) | `real` |
| `payables` | `paidValue > 0 AND cancelled = false`, por `paidDate` = contas pagas | `real` (mas **parcial**: sangria/despesa de caixa não sincronizam) |

**Normalização de forma de pagamento** (substitui `TYPE_MAP` de `routes.ts:787` e `:933`, que só
reconhecia 4 literais exatos e jogava CARTÃO/PIX/crediário reais em "outros"): função
`normalizePaymentType(raw)` — remove acento/mojibake (`ã`→`a`, `é`→`e`, `â`→`a`, `á`→`a`),
uppercase, então: `%PIX%`→`pix`; `%PRAZO%` ou `%CREDIARIO%` ou `%CREDITO LOJA%` ou `%CARTAO DA
LOJA%`→`crediario`; `%CARTAO%` ou `%DEBITO%` ou `%CREDITO%`→`cartao`; `DINHEIRO`→`dinheiro`;
`SEM PAGAMENTO`→ignora (não soma); resto→`outros`. Ordem importa: crediário antes de cartão
(literal `CARTÃO DA LOJA, CREDIÁRIO DIGITAL` é crediário, não cartão).

**Endpoints:**
- `GET /api/reports/cashflow?from&to&storeId&granularity=day|week|month` — `cached()` com
  granularity na chave; default período = mês atual (regra do dono 23/08); granularidade
  automática (>31 dias = semana) se não informada. Shape **flat** por linha pra
  `FluxoCaixaChart.tsx` funcionar sem adaptador:
  `{ data: [{ dia, entradas, saidas, saldoDia, saldoAcumulado, detalhe: { vendas: { dinheiro, cartao, pix, outros }, avulsos, crediarioRecebido, contasPagas } }], totals: { entradas, saidas, variacao }, quality: { saidasParciais: true, crediarioExcluidoDasVendas: true, avulsosNaoClassificados: number, baixaParcialUnicaData: true, semSaldoInicial: true, paymentsRecentes: boolean }, meta }`.
- `GET /api/reports/cashflow/day?date&storeId` — drill-down: entradas (Payment com forma +
  saleId, Receivable com counterparty) e saídas (Payable com counterparty · description), ≤200
  linhas.
- `GET /api/reports/cashflow-forecast?days=7|15|30|60|90&storeId` — RECEBER e PAGAR em aberto
  (`value − receivedValue/paidValue > 0`, `cancelled=false`) entre hoje e hoje+days, por
  `dueDate`; `overdue` = vencidos antes de hoje. Shape exato do `CashflowForecast.tsx`:
  `{ data: [{ dia, entradas, saidas, saldo }], totals, overdue: { entradas, saidas }, meta }`.
- `cash-detailed` passa a chamar `buildCashflow` → **muda os números** que CaixaDetalhadoPage já
  mostra (saídas deixam de ser 0). Release note obrigatória. `cash-movements` NÃO muda (lista
  paginada de Payment; incluir Payable exigiria merge paginado — onda 2).

**Nunca mostra "saldo em caixa"** — sem `CashClosing` sincronizado não há saldo inicial. É
"variação do período".

## D17. DRE v1 — extrato vertical com selo por linha, sem a palavra "lucro"

Evoluir `GET /api/reports/dre-simplified` (mesma URL, zero consumidores hoje) com
`?regime=caixa|vencimento` (**não** chamar de "competência": `Payable` não tem data de emissão
sincronizada, só vencimento). Corrige o erro atual (cancelamentos subtraídos de uma receita que já
não os continha).

`lines[]`, cada `{ key, label, value: number|null, pct: number|null, status: 'real'|'estimate'|'nd', note }`:

| key | fonte | status |
|-----|-------|--------|
| `receita_bruta` | `Sale.cancelled=false`, **sem** filtrar `processed` (P2), natureza NOT LIKE `Devolução%`/`Complementar%` | real |
| `descontos` | não sincronizado (VENDAS.DESCONTO) | nd |
| `devolucoes` | não mapeado (só 5 linhas de "Devolução de compra" na prod, que é devolução a fornecedor, não de cliente) | nd |
| `receita_liquida` | = bruta (descontos/devoluções nd) | estimate |
| `cmv` | Σ `SaleItem.quantity × Product.costPrice` + `coverage` (% dos itens com custo); UI só mostra com coverage ≥ 50% — hoje `products` está vazio (agente não sincroniza) | nd |
| `margem_bruta` | = receita_liquida − cmv | nd |
| `despesas` | regime caixa = Σ `paidValue` por `paidDate`; vencimento = Σ `value` por `dueDate`; `cancelled=false` | estimate (parcial: só PAGAR) |
| `impostos` | não sincronizado | nd |
| `resultado` | receita_liquida − despesas (− cmv se disponível) | estimate |

`memo`: `{ cancelamentos: { value, count }, naoProcessadas: { value, count }, naturezas: [{ natureza, modelo, count, value }], cmvCoverage, receitaPorModelo: { PV, '65', '55' } }` — cancelamentos como
**informação**, nunca dedução. `despesasPorFornecedor` top 10 (`groupBy counterparty`, percent
0-100) alimenta o `PlanoContasCard` refatorado. Mantém `payments` por tipo.

## D18. Kit mobile-first mínimo (5 componentes + 3 libs) e top bar

Critério de pronto por tela: **375×667 sem scroll horizontal no body, KPI visível sem rolar, erro
de API renderizado** (não "Sem dados"), screenshots 375/768/1280 no PR.

- `lib/masks.ts`: mover `formatCompactBRL` (hoje local em `FinanceCalendar.tsx:242`) e exportar;
  `formatBRL`/`formatInt`/`formatBrDate` como fonte única (hoje `formatBRL` é duplicado em 10+
  arquivos).
- `lib/period.ts`: `currentMonthRange()` (dia 1 até hoje) + presets Hoje / 7 dias / Mês atual /
  Mês anterior.
- `lib/whatsapp.ts`: `buildWhatsAppResumo({ titulo, periodo, linhas })` genérico (hoje duplicado
  em Dashboard:244 e ContasPagar:178) + `CopyWhatsAppButton`.
- `components/ui/PageHeader` `{ title, subtitle, actions }`.
- `components/ui/KpiCard` `{ label, value, tone, sub, highlight, compact }` + `KpiRow` —
  `grid-cols-2 sm:grid-cols-3 lg:grid-cols-N`, **nunca 1 coluna no mobile**.
- `components/ui/DateRangeFilter` — base no `DateFilter` de `RelatoriosPage:55-79`, flex-wrap,
  chips de preset.
- `components/ui/Badge` `{ tone }` + `DataQualityBanner` `{ items: [{ label, kind }], meta }` —
  UM banner: defasagem (`stalenessSeconds > 300`, D7) + avisos vindos do objeto `quality`/`status`
  do endpoint. **Texto sai do dado, não de string fixa.**
- `components/ui/CardList<T>` `{ rows, columns, renderCard, keyOf, onRowTap }` — extrai o padrão
  de `ContasPagarPage:121-170` (`sm:hidden divide-y` cards + `hidden sm:block overflow-x-auto`
  table).
- `components/ui/QueryState` `{ query, empty }` — Spinner / ErrorBox / EmptyPeriod.
- `AppShell.tsx`: **top bar mobile** `lg:hidden fixed h-12 z-40` com hambúrguer + título da rota
  + `TenantSelector` compacto + `NotificationBell`; corrige z-index (botão e overlay dividem
  `z-30` hoje). Itens `Fluxo de Caixa` (`/fluxo-caixa`) e `DRE` (`/dre`) logo após Financeiro.
- Refatorar `PlanoContasCard` pra receber `{ title, data: [{ label, value, percent }], total }`
  por props (hoje busca sozinho `/dashboard/plano-contas`, que não existe). Ajustar URLs de
  `FluxoCaixaChart` (→`/cashflow`) e `CashflowForecast` (→`/cashflow-forecast`). Extrair
  `MetaMensalHeroCard` de `HeroCards.tsx` (as outras 3 cards dependem de endpoints inexistentes).

**Fora de escopo registrado:** bottom nav (decisão de produto pra onda futura), Pagination/Modal/
ChartCard genéricos.

## D19. Correções ao openspec existente (achadas no mapeamento)

- `create-saas-platform/design.md` D4 diz que ESTOQUE/CLIENTES/FECHAMENTO_CAIXA são
  sincronizadas — **não bate com o código**: `syncer.ts` só tem sales/saleItems/payments/
  payables/receivables; backend aceita `products`/`customers`/`cashClosings` mas o agente nunca
  envia. Corrigir D4.
- `specs/dashboard-reports/spec.md:13` diz "período padrão = últimos 30 dias" — a regra do dono
  (23/08) é **mês atual, dia 1 até hoje**, e o backend já faz isso (`routes.ts:72-82`). Corrigir a
  spec. Também cita `CONTAS_PAGAR` onde a prod confirmada é `PAGAR/RECEBER` (D11).

## Riscos

| Risco | Mitigação |
|-------|-----------|
| `SYNC_SALE_ITEMS_AND_PAYMENTS_ENABLED` voltar a `false` zera `Payment` silenciosamente | `quality.paymentsRecentes=false` quando não há Payment nos últimos 2 dias com agente online → banner |
| Cliente ler "resultado" como lucro | Nunca usar "lucro"; badge `estimativa` + "X de 8 linhas com dado real" no topo |
| `cash-detailed` mudar de número assusta quem já usa | Release note + rótulo "Saídas = contas a pagar baixadas" |
| Avulsos serem sangria e não recebimento (inflam entrada) | Linha separada `estimate`; confirmar no Firebird do piloto quando houver acesso (backlog) |
| `pct` de receita com receita 0 → divisão por zero | `pct: null` quando denominador = 0 |

## Backlog de dado (fora do MVP)

Sync de produto/custo (6-8h), direção em MOV_OPERADORES ou tabela de caixa (8-14h + Firebird),
CashClosing (5h), categoria do PAGAR (6-16h), baixas parciais (8-10h), DESCONTO/devoluções (4h).
Cada tabela nova precisa de `detectSchema` como o financeiro (D11 provou que varia).
