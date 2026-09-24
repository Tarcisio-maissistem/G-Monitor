# Design — Demandas do gestor J.Kastros

1. **Procedem** (set/26: 1.961 transações casadas; 3 só no sistema, 11/09, R$ 371,50, todas JESSICA/caixa 001/vendas 616298-616300).
   `conciliacao/quemLancou.ts` (PR #129): só no sistema → operador/vendedor/caixa/nº/hora da venda; só na maquininha → operador PROVÁVEL do caixa/hora.
2. **Sem inversão**: dono confirmou (24/09) — via TEF, crédito → Bradesco (CIELO) e débito + PIX Shipay → Itaú (REDE); fora do TEF é POS/PIX avulso. É o cadastro atual (`meta.adquirentes`). Bradesco maior = crédito R$ 124 mil × débito R$ 82 mil em set/26.
3. **Depende do agente ≥ 0.9.11**: `MOV_OPERADORES` tem `OPERADOR` (código) e `HORA`; o agente 0.9.9 manda o operador, nenhum manda a hora; nome do usuário vem de `USUARIOS(ID, USUARIO)`.
4. `reports/fechamentoResumo.ts` (pura, testada) + `resumo` no `GET /api/reports/monthly-closing` + bloco "Resultado do mês" na tela.
   Vendas = pagamentos kind venda por forma; recebidos = `receivables.receivedValue` no mês (o `kind='recebimento'` fica fora para não contar 2x);
   saídas = `payables.paidValue` no mês por FORNECEDOR até o agente trazer `PAGAR.NUM_CONTA` (plano de contas).
