# Tasks — Operadores de caixa

Marcar `[x]` à medida que implementa. Item de código só fecha com prova (tsc/vitest/curl).

## Fase 0
- [x] Dados reais conferidos (24/09): operador 99% preenchido na Casa (4 operadores), 16 vendedores; Ferragista login único "CAIXA"; payments.operador vazio
- [x] GDOOR tem `AUDITORIA(USUARIO, INFO, ADICIONAIS, DATA, HORA)` e `ITEVENDAS.VALOR_DESCO/CANCELADA/VENDEDOR`
- [x] proposal.md + design.md

## Fase 1 — backend
- [x] `reports/operadores.ts` com `classificarVenda` (testes) e `relatorioOperadores`
- [x] `GET /api/reports/operadores` (cached)
- [x] tsc + vitest (97/97; 13 novos; consulta real Casa set/26 em 0,2 s)

## Fase 1 — web
- [x] contrato em `lib/reports.ts`
- [x] `OperadoresPage.tsx` + rota + menu
- [x] tsc + build

## Fase 1 — publicar
- [ ] PR + merge + deploy no servidor local; conferir com dado real da Casa

## Fase 2 — agente + nuvem (preparar; instalação nas lojas é passo físico)
- [ ] catálogo AUDITORIA + campos novos de item/pagamento
- [ ] migration `audit_events` + colunas de item
- [ ] ocorrência mostra quem alterou
