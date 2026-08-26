# Tasks — Fluxo de Caixa + DRE + kit mobile-first

Marcar `[x]` à medida que implementa. Cada item de código só fecha com prova (tsc/vitest/curl/screenshot).

## Fase 0 — antes de código
- [x] Queries de diagnóstico na prod (formas de pagamento reais, fuso, naturezas, processed) — 25/08
- [x] 3 decisões de produto tomadas pelo dono (P1 crediário na baixa, P2 PV/65/55 = venda, P3 liberar com selo)
- [x] proposal.md + design.md (D16-D19)
- [ ] D19: corrigir `create-saas-platform/design.md` D4 e `specs/dashboard-reports/spec.md` (período padrão, PAGAR/RECEBER)

## Fase 1 — backend (`apps/backend`) — FEITO 25/08 (PR #42)
- [x] `src/reports/paymentType.ts`: `normalizePaymentType(raw)` + 14 testes com os literais reais
- [x] `src/reports/cashflow.ts` + `cashflowMerge.ts` (merge puro testado, 15 testes)
- [x] `GET /api/reports/cashflow` · `/cashflow/day` · `/cashflow-forecast`
- [x] `dre-simplified` evoluído (regime, lines[] com status, memo, despesasPorFornecedor; subtração errada corrigida)
- [x] `cash-detailed` → `buildCashflow`; os 2 `TYPE_MAP` → `normalizePaymentType`
- [x] `quality.paymentsRecentes`
- [x] `tsc` limpo + `vitest` 29/29

## Fase 2 — kit UI + AppShell (`apps/web`) — FEITO 25/08 (PR #42)
- [x] `lib/masks.ts` (formatCompactBRL), `lib/period.ts`, `lib/whatsapp.ts` + `CopyWhatsAppButton`, `lib/reports.ts` (contrato TS dos endpoints)
- [x] `components/ui/`: PageHeader, KpiCard/KpiRow, DateRangeFilter, Badge/DataStatusBadge, DataQualityBanner, CardList, QueryState
- [x] `AppShell.tsx`: top bar mobile, z-index, NAV com Fluxo de Caixa e DRE; TenantSelector `compact`
- [x] `PlanoContasCard` (props), `FluxoCaixaChart`, `CashflowForecast`, `MetaMensalHeroCard`
- [x] `tsc` limpo

## Fase 3 — telas — FEITO 25/08 (PR #42 + #43)
- [x] `FluxoCaixaPage.tsx` (`/fluxo-caixa`) · [x] `DrePage.tsx` (`/dre`) · [x] rotas em `App.tsx`
- [ ] `DashboardPage.tsx`: seção "Caixa do mês" + `MetaMensalHeroCard` — ADIADO (economia de tokens, pedido do dono)
- [ ] `CaixaDetalhadoPage.tsx` rótulo "Saídas = contas a pagar baixadas" — ADIADO (o número JÁ mudou no backend; só falta o texto)
- [ ] `FinanceiroPage.tsx` texto · `LoginPage.tsx` break-all — ADIADOS
- [x] `tsc` + `vite build` limpos

## Fase 4 — verificação + gate
- [x] Playwright 375px: /fluxo-caixa e /dre renderizam, 0 erro de API, sem scroll horizontal (screenshots vistos 25/08)
- [ ] Screenshots 768/1280 — só desktop do DRE tirado, não conferido (economia)
- [ ] Conferência cruzada `/cashflow` × `/payments-summary` × ContasPagar/Receber — PENDENTE
- [ ] DRE do mês conferido pelo Tarcísio contra o GDOOR — PENDENTE (agente do piloto offline, agosto tem 2 vendas)
- [x] OK explícito do dono pra deploy (25/08)

## Fase 5 — deploy — FEITO 25/08
- [x] Backend (ms-gestor) → smoke 401 nas 3 rotas novas = existem
- [x] Frontend (build local, nginx serve dist/)
- [x] Release note: Caixa Detalhado mudou de número — avisado ao dono antes do OK
- [ ] `graphify update` — ADIADO (economia)
- [x] Memória atualizada

## D20 — Conferência de Caixa + P4/P5 (26/08) — EM PROD (PR #47)
- [x] P4 SALE_OF_RECORD (PV+55; NFC-e 65 fora, exceto direta com pagamento) em todos os relatórios
- [x] P5 Payment.kind (sangria/suprimento/recebimento/venda) — agente + backend + fluxo de caixa
- [x] CashClosing(+pdv, openingAmount) + CashClosingSpecies; syncs no agente v0.8.0; migrations aplicadas
- [x] GET /api/reports/cash-conference + tela /conferencia-caixa (mobile-first)
- [x] Dashboard: alerta "NFC-e sem pré-venda"
- [ ] Instalar agente v0.8.0 no PC do dono + lojas J.Kastros; re-sync do histórico (checkpoints) pra popular saleHour/sellerName/kind/fechamentos
- [ ] Validar conferência contra loja real (banco do dono tem fechamentos zerados)
- [x] Ranking de vendedores: ticket médio + variação vs período anterior + UPPER(TRIM) (PR #49)
- [x] Inadimplentes + aging + % fiado + saldo projetado no dashboard — /dashboard/financial-position (PR #49)
- [ ] KG / clientes com nome / dias sem comprar — exigem sync de ESTOQUE (UND) e CLIENTES (adiado pelo dono)
- [x] Auto-update do agente: updater lê /downloads/latest.json (gerado no `pnpm package`), NSSM AppExit=Restart no install.ps1, versão no painel (PR #49)
