# Design — Operadores de caixa

## Fase 1 (sem agente novo)
### Backend
- `src/reports/operadores.ts`
  - `classificarVenda(v, limiteDescontoPct)` — **pura, testada**: devolve as ocorrências de uma venda:
    `cancelada` · `sem_itens` · `pre_venda_zerada` (total 0 com itens) · `desconto` (itens − total >
    limite% dos itens) · `pago_a_menor` (soma dos pagamentos vinculados < total − R$0,05).
  - `relatorioOperadores(prisma, { tenantId, storeId, from, to, operador?, limiteDescontoPct })`:
    1 consulta SQL agregando vendas + soma de itens + soma de pagamentos por venda (período),
    classifica em JS e agrega por operador e por vendedor. Fechamentos por operador de
    `cash_closings.operatorName`. Ocorrências limitadas a 500 (mais recentes primeiro) + contagem total.
- `GET /api/reports/operadores?from&to&storeId&operador&limiteDesconto` em `reports/routes.ts`,
  com `cached()` (cache por versão de dado) e `SALE_OF_RECORD` (NFC-e 65 fora: duplica o PV).
- Operador vazio vira `(sem operador)` — aparece, não some.

### Web
- `pages/OperadoresPage.tsx` (`/operadores`, item "Operadores" 🧑‍💼 no menu), kit `components/ui`:
  KPIs · tabela por operador (toque filtra as ocorrências) · tabela por vendedor · lista de
  ocorrências com badge do tipo, operador, vendedor, caixa, venda nº, valor · filtro de tipo e de
  limite de desconto · exportar CSV (`lib/exportCsv`).
- Contrato TS em `lib/reports.ts`.

## Fase 2 (agente ≥ 0.9.11 + migration)
- Catálogo: `sync-auditoria-batch` (AUDITORIA não tem ID → incremental por DATA/HORA com
  checkpoint `data|hora` e dedupe por hash das colunas), itens com `VALOR_DESCO`, `CANCELADA`,
  `VENDEDOR`; pagamento com operador.
- Tabelas `audit_events` e colunas novas em `sale_items` (desconto, cancelado, vendedor).
- Ocorrência passa a mostrar **quem alterou** além de quem lançou.
- Instalação nos PCs das lojas (auto-update não funciona lá — ver memória de 04/09).
