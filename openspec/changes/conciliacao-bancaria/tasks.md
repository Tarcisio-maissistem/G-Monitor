# Tasks — Conciliação bancária

Marcar `[x]` só com prova (tsc/vitest/curl/screenshot). Nada de "parece certo".

## Fase 0 — apuração (FEITA 26/08)
- [x] Mapear tabelas de cartão/TEF/taxa no Firebird do cliente
- [x] Confirmar NSU em 100% das 8.561 transações (chave de conciliação viável)
- [x] Descobrir que `TAXAS_CARTAO` está toda zerada -> D21 (taxa cadastrada no G-Monitor)
- [x] Confirmar que `TEF_VENDAS`/`TEF_POS` estão vazias (dado do TEF só no portal)
- [x] Confirmar portal alcançável e o tipo de autenticação (CodeIgniter, CSRF + sessão)
- [x] proposal.md + design.md (D21-D25)

## Fase 1 — transações de cartão (não depende de credencial)
- [ ] Catálogo do agente: `sync-card-transactions-batch` (MOVIMENTACAO_CARTAO + LEFT JOIN
      VENDA_PAGAMENTO_CARTAO/MOV_OPERADORES para o vínculo com a venda)
- [ ] Migration `CardTransaction` (+ REVOKE/GRANT: tabela nova nasce gravável pelo anon)
- [ ] `bulkUpsert` case `cardTransactions` no syncRoutes
- [ ] Agente v0.9.0 + auto-update publicado
- [ ] Prova: contar transações sincronizadas x 8.561 do Firebird

## Fase 2 — taxas e líquido previsto — EM PROD 26/08 (PR #69)
- [x] `feeChannel()` separa pos_debito/pos_credito/pix_tef/pix_estatico (+3 testes, 32/32)
- [x] Taxas em `tenant.meta.feeRules` — SEM migration (mesmo padrao de monthlyGoal); decidido
      assim pra nao gastar o gate de banco numa config de poucas linhas por loja
- [x] `GET /api/reports/conciliacao/previsto`: bruto, taxa, liquido e dias por canal
- [x] Canal sem regra fica FORA do liquido e e sinalizado (D21)
- [x] Tela `/conciliacao` mobile-first: cards + lista por canal + cadastro das taxas
- [x] Prova (26/08, Piloto, agosto): debito 231.342,24 + credito 229.353,45 = 460.695,69 bate
      com `cartao` do sales-by-payment; pix_tef 6.005,71 + pix_estatico 302.439,17 = 308.444,88
      bate com `pix`. Screenshot 390px sem erro.
- [ ] Taxa por ADQUIRENTE (Cielo x Rede) — depende da Fase 1 (MOVIMENTACAO_CARTAO)

## Fase 3 — extrato do portal TEF (DESBLOQUEADA 27/08 — fluxo mapeado e validado, D26)
- [x] Mapear login (CSRF + sessao), filtro por periodo e paginacao — validado com curl
- [x] Mapear as 14 colunas e as armadilhas do parser (adquirente+bandeira concatenados, R$ br)
- [x] Descobrir que o portal cobre 2 PDVs e diverge do GDOOR no mesmo dia (D27)
- [x] `secretBox.ts` (AES-256-GCM, `INTEGRACAO_ENC_KEY`) + 4 testes; chave gerada NO ms-gestor
- [x] Credencial em `tenant.meta.getcard` com a senha cifrada — SEM migration; API devolve
      apenas `temSenha`, nunca a senha (nem mascarada)
- [x] Coletor `getcard.ts`: login (CSRF+sessão) -> POST do período -> paginação por GET.
      HTML de login => `CredencialInvalida` explícita, nunca lista vazia (D25)
- [x] Parser puro com 8 testes sobre HTML REAL do portal
- [x] `matcher.ts`: casa por (dia+valor), hora como desempate, 2ª chance em outras formas de
      cartão (D29); 10 testes, incluindo os 2 casos reais de agosto
- [x] Sem tabela de extrato: a comparação é feita na hora e devolvida — histórico fica pra depois
- [x] `GET /api/reports/conciliacao/extrato` + seção na tela `/conciliacao`
- [x] **PROVA EM PRODUÇÃO (27/08, período 21-23/08):** 346 transações colhidas do portal,
      **345 conciliadas**, e a única apontada foi exatamente a R$ 567,80 de 22/08 11:08:43
      (CIELO, NSU 002319) — a mesma que a investigação manual tinha achado. Zero falso positivo,
      zero dia ignorado. Tela conferida em 390px.
- [ ] Período longo (mês inteiro = 29 páginas) estoura o tempo do gateway: quebrar a coleta em
      blocos ou rodar em segundo plano. Por ora usar períodos de até ~1 semana.

## Achado de negócio (26/08)

No Piloto, em agosto, o **PIX estático é o maior canal eletronico**: R$ 302.439 (1.359
transacoes) — mais que debito (R$ 231.342) e que credito (R$ 229.353). O PIX pelo TEF/Shipay
e residual: R$ 6.005 (48 transacoes). Ou seja, a taxa que mais pesa no bolso e a do PIX
estatico, nao a do cartao — cadastrar essa primeiro e o que mais muda o numero.

## Pendências com o Tarcísio
- [x] Credencial do portal recebida 27/08 — fluxo mapeado (D26)
- [x] Divergencia explicada 27/08: era comparacao com a tabela ERRADA (MOVIMENTACAO_CARTAO).
      Contra TEF CREDITO+DEBITO o portal bate centavo a centavo em 18 dos 23 dias completos.
- [x] Investigados os 5 dias (27/08, D29): 05/21/23 casaram 100% com a coluna de data certa;
      03/08 (R$49,43) era `CREDITO ENTREGA`, nao divergencia; sobrou UMA real: **R$ 567,80 em
      22/08** (PROCESSADA=0, sem virar venda). Unica do mes inteiro.
- [ ] Mostrar ao dono a transacao de R$567,80 (22/08 11:08, NSU 002319, aut 684385, CIELO)
- [x] Alerta proprio no painel (27/08, PR #80 aprovado pelo dono + #81): migration
      `card_transactions` aplicada via Management API (anon SEM grant, RLS ligada, registrada
      em _prisma_migrations); agente v0.9.0 sincroniza MOVIMENTACAO_CARTAO;
      `GET /api/reports/conciliacao/cobrancas-sem-venda` + faixa vermelha na tela.
      "Sem dado" (agente antigo) e tratado diferente de "nada a reportar" — a tela nao diz
      que esta tudo certo quando so nao sincronizou ainda.
- [ ] Taxas reais para cadastrar: POS por adquirente (Cielo/Rede), PIX TEF (Shipay), PIX estático
