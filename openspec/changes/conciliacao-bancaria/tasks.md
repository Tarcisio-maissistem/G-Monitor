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
- [ ] `secretBox.ts` no backend (AES-256-GCM, `INTEGRACAO_ENC_KEY`) + gerar a chave no .env do ms-gestor
- [ ] Migration `IntegrationCredential` (portal TEF: usuário + senha cifrada)
- [ ] Tela Configurações -> Integrações: usuário/senha do portal; API devolve só `temSenha`
- [ ] Coletor: login (CSRF+sessão) -> filtro de datas -> CSV; HTML de login => erro explícito (D25)
- [ ] Parser do CSV (depende do arquivo real: colunas de NSU/bruto/taxa/líquido/data)
- [ ] Migration `AcquirerStatement` + casamento por `(adquirente, NSU, data)` (D22)
- [ ] Tela Conciliação (aba "Conciliado"): 4 estados (D23), com filtro e total por estado
- [ ] Prova: conciliar um dia real e conferir 3 transações na mão contra o portal

## Achado de negócio (26/08)

No Piloto, em agosto, o **PIX estático é o maior canal eletronico**: R$ 302.439 (1.359
transacoes) — mais que debito (R$ 231.342) e que credito (R$ 229.353). O PIX pelo TEF/Shipay
e residual: R$ 6.005 (48 transacoes). Ou seja, a taxa que mais pesa no bolso e a do PIX
estatico, nao a do cartao — cadastrar essa primeiro e o que mais muda o numero.

## Pendências com o Tarcísio
- [x] Credencial do portal recebida 27/08 — fluxo mapeado (D26)
- [ ] **Explicar a divergencia do dia 06/08** (portal 97/R$8.528 x GDOOR 43/R$4.781): o PDV 002
      esta integrado ao GDOOR desta maquina? ha venda passada direto na maquininha?
- [ ] Taxas reais para cadastrar: POS por adquirente (Cielo/Rede), PIX TEF (Shipay), PIX estático
