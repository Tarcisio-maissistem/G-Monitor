# Proposal — Operadores de caixa e "quem lançou" em cada ocorrência

## Problema (dono, 24/09/2026)
O dono precisa ver **os operadores de caixa e tudo o que passou de venda por cada um**, e que
**todo erro mostre qual usuário lançou a venda**. Hoje o G-Monitor tem o operador em
`sales.operatorName` (99% preenchido na Casa J.Kastros) e o vendedor em `sales.sellerName`,
mas só aparece em rankings soltos (top-operators, seller-ranking, comissão). Nenhuma tela junta
o que cada operador fez, e as inconsistências (venda cancelada, sem itens, desconto, pré-venda
zerada) não mostram quem lançou.

## Objetivo
- Tela **Operadores** (`/operadores`): por operador de caixa e por vendedor — vendas, total,
  ticket médio, cancelamentos, descontos, vendas sem itens, pré-vendas zeradas, fechamentos.
- Lista de **ocorrências** (os "erros") sempre com operador, vendedor, caixa, data/hora e número
  da venda no GDOOR. Filtro por operador e por tipo.
- Fase 2: trazer do GDOOR **quem alterou** (tabela `AUDITORIA`: usuário, ação, data/hora),
  desconto e cancelamento **por item** e o operador de cada pagamento — exige agente novo.

## Fora do escopo
- Alterar dado no GDOOR (o G-Monitor só lê).
- Ferragista J.Kastros usa um login único ("CAIXA"): sem usuário por pessoa no GDOOR não há como
  separar operadores. Decisão do dono pendente.

## Decisões
- Limite de "desconto alto" padrão **10%** do valor dos itens, ajustável na tela (dono não fixou).
- Ocorrência de pagamento só quando o pago é **menor** que a venda (pago a maior em dinheiro é troco).
