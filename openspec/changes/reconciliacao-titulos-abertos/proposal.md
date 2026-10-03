# Reconciliação de títulos em aberto (contas a pagar / a receber)

## Problema

O lojista paga a conta no GDOOR e o G-Monitor continua mostrando o título como **vencido**,
com R$ 0,00 na coluna de pago. Achado em 03/10/2026 no cliente Casa de Carnes J.Kastros:
**20 contas a pagar (~R$ 56 mil) e 111 contas a receber** presas nesse estado — o relatório de
inadimplência mostrado ao lojista está inflado.

O status não é o defeito: `classifyFinanceStatus` classifica certo para o dado que chegou. O que
falha é o sync não trazer a baixa:

1. O sync incremental é `WHERE ID > checkpoint ORDER BY ID ASC`. Quando o GDOOR dá baixa, ele faz
   UPDATE na linha e **o ID não muda** — o agente nunca revisita aquele registro.
2. A única recuperação é a janela recente, com `RECENT_DAYS = 7` e
   `WHERE VENCIMENTO >= since OR PAGAMENTO >= since`. Conta paga com **mais de 7 dias de atraso**
   não casa nenhuma das duas datas e nunca mais é lida. Exemplo real: CARVAO e PALHOL, vencidos
   em 17/09 e pagos depois — 16 dias fora da janela.
3. A janela recente só é agendada quando o schema é `pagar_receber`; **não existe
   `sync-payables-recent-contas-pagar`** no catálogo. Numa instalação da variante
   `CONTAS_PAGAR`/`CONTAS_RECEBER` nenhuma baixa é atualizada, nunca.

Efeito perverso: justamente a conta paga **em atraso** fica marcada como vencida para sempre.

## Objetivo

O estado de pagamento no G-Monitor converge com o GDOOR **independentemente de quanto tempo
depois do vencimento a baixa foi dada** e **nas duas variantes de schema**.

Abordagem escolhida (decisão do dono, 03/10 — opção 1 de 3): **reconciliação dirigida pela nuvem**.
Em vez de adivinhar uma janela de tempo, a nuvem diz quais títulos ela ainda considera em aberto e
o agente relê exatamente esses no Firebird. O conjunto é pequeno por natureza (dezenas), então o
custo é baixo e não cresce com o histórico.

Descartadas: ampliar a janela de 7 para N dias (remendo — títulos pagos com atraso maior que N
continuam presos, e o `FIRST 5000 ORDER BY ID ASC` pode cortar os IDs mais altos); e resync completo
periódico (relê 7.367 linhas para corrigir 20).

## Fora de escopo

- Mudar a regra de classificação de status (está correta).
- Reconciliar vendas/itens/pagamentos (o problema é específico de título com baixa posterior).
