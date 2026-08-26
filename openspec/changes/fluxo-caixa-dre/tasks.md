# Tasks — Fluxo de Caixa + DRE + kit mobile-first

Marcar `[x]` à medida que implementa. Cada item de código só fecha com prova (tsc/vitest/curl/screenshot).

## Fase 0 — antes de código
- [x] Queries de diagnóstico na prod (formas de pagamento reais, fuso, naturezas, processed) — 25/08
- [x] 3 decisões de produto tomadas pelo dono (P1 crediário na baixa, P2 PV/65/55 = venda, P3 liberar com selo)
- [x] proposal.md + design.md (D16-D19)
- [ ] D19: corrigir `create-saas-platform/design.md` D4 e `specs/dashboard-reports/spec.md` (período padrão, PAGAR/RECEBER)

## Fase 1 — backend (`apps/backend`)
- [ ] `src/reports/paymentType.ts`: `normalizePaymentType(raw)` com os literais reais da Fase 0 + teste unitário (vitest) cobrindo cada literal → chave
- [ ] `src/reports/cashflow.ts`: `buildCashflow(tenantId, storeId, from, to, granularity)` — 3 `$queryRaw` + merge por dia em JS; `quality{}`; teste de função pura (venda cancelada não entra, crediário não conta 2x, saldo acumulado bate, avulsos em linha própria)
- [ ] `GET /api/reports/cashflow` (cached, granularity na chave, default mês atual)
- [ ] `GET /api/reports/cashflow/day`
- [ ] `GET /api/reports/cashflow-forecast` (shape do CashflowForecast.tsx + `overdue`)
- [ ] Evoluir `GET /api/reports/dre-simplified` (`?regime=caixa|vencimento`, `lines[]` com status, `memo`, `despesasPorFornecedor`; corrigir subtração errada de cancelamentos)
- [ ] `cash-detailed` → `buildCashflow`; `TYPE_MAP` (financial + monthly-closing) → `normalizePaymentType`
- [ ] `quality.paymentsRecentes` (sem Payment nos últimos 2 dias com agente online)
- [ ] `tsc --noEmit` limpo + `vitest run` verde

## Fase 2 — kit UI + AppShell (`apps/web`)
- [ ] `lib/masks.ts`: `formatCompactBRL` exportado (mover de FinanceCalendar), `formatBRL`/`formatInt`/`formatBrDate` fonte única
- [ ] `lib/period.ts`: `currentMonthRange()` + presets
- [ ] `lib/whatsapp.ts`: `buildWhatsAppResumo` genérico + `CopyWhatsAppButton`
- [ ] `components/ui/PageHeader.tsx`
- [ ] `components/ui/KpiCard.tsx` + `KpiRow` (nunca 1 coluna no mobile)
- [ ] `components/ui/DateRangeFilter.tsx`
- [ ] `components/ui/Badge.tsx` + `DataQualityBanner.tsx` (texto vem do `quality`/`status` do endpoint)
- [ ] `components/ui/CardList.tsx` (`ResponsiveTable<T>`, padrão de ContasPagarPage)
- [ ] `components/ui/QueryState.tsx`
- [ ] `AppShell.tsx`: top bar mobile (hambúrguer + título + TenantSelector compacto + sino), z-index corrigido, itens Fluxo de Caixa e DRE no NAV
- [ ] Refatorar `PlanoContasCard` (props), `FluxoCaixaChart` (URL + height prop), `CashflowForecast` (URL + vencidos), extrair `MetaMensalHeroCard`
- [ ] `tsc --noEmit` limpo

## Fase 3 — telas (`apps/web/src/pages`)
- [ ] `FluxoCaixaPage.tsx` (`/fluxo-caixa`): Realizado | Projetado, KpiRow, DataQualityBanner, CardList por dia com drill-down `/cashflow/day`
- [ ] `DrePage.tsx` (`/dre`): extrato vertical com Badge por linha, toggle Caixa | Por vencimento, "X de 8 linhas com dado real", despesas por fornecedor, CopyWhatsAppButton
- [ ] `App.tsx`: rotas `/fluxo-caixa` e `/dre`
- [ ] `DashboardPage.tsx`: seção "Caixa do mês" (KpiRow de `/cashflow`), `MetaMensalHeroCard`, barra de formas em grid, DataQualityBanner no lugar dos 2 banners atuais
- [ ] `CaixaDetalhadoPage.tsx`: rótulo "Saídas = contas a pagar baixadas" + banner
- [ ] `FinanceiroPage.tsx`: corrigir texto desatualizado (l.160-163)
- [ ] `LoginPage.tsx` SignupDone: `break-all` no `<code>`
- [ ] `tsc --noEmit` + `vite build` limpos

## Fase 4 — verificação + gate
- [ ] Screenshots 375 / 768 / 1280 de FluxoCaixa, DRE, Dashboard — sem scroll horizontal no body
- [ ] Conferência cruzada: totais de `/cashflow` × `/payments-summary` × ContasPagar/Receber do mesmo período
- [ ] DRE do mês conferido linha a linha pelo Tarcísio contra o GDOOR
- [ ] `guarda-de-impacto` (raio de impacto: cash-detailed muda de número, TYPE_MAP muda financial/monthly-closing)
- [ ] Diff apresentado ao Tarcísio → OK explícito

## Fase 5 — deploy (só com OK do dono)
- [ ] Backend primeiro (ms-gestor: pull + build + `pm2 delete` + `pm2 start` com .env sourced — restart não recarrega env)
- [ ] Frontend depois (build local neste host, nginx serve `dist/`)
- [ ] Release note: Caixa Detalhado mudou de número (saídas deixaram de ser 0)
- [ ] `graphify update`, memória atualizada, tasks.md fechado
