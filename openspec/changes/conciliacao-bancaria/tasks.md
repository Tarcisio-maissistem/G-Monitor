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

## Fase 2 — taxas e líquido previsto (não depende de credencial)
- [ ] Migration `FeeRule` + CRUD `/api/fees` (só admin/gestor)
- [ ] Tela Configurações -> Taxas: POS por adquirente/tipo/parcelas, PIX TEF (Shipay), PIX estático
- [ ] `GET /api/reports/conciliacao/previsto`: bruto, taxa, líquido, data prevista, por adquirente/canal
- [ ] Transação sem regra de taxa aparece como "sem taxa cadastrada" e fica FORA do líquido (D25)
- [ ] Tela Conciliação (aba "Previsto") mobile-first + ⓘ nos cards
- [ ] Prova: bruto do período bate com `sales-by-payment` (cartão + PIX)

## Fase 3 — extrato do portal TEF (BLOQUEADA: precisa da credencial do dono)
- [ ] `secretBox.ts` no backend (AES-256-GCM, `INTEGRACAO_ENC_KEY`) + gerar a chave no .env do ms-gestor
- [ ] Migration `IntegrationCredential` (portal TEF: usuário + senha cifrada)
- [ ] Tela Configurações -> Integrações: usuário/senha do portal; API devolve só `temSenha`
- [ ] Coletor: login (CSRF+sessão) -> filtro de datas -> CSV; HTML de login => erro explícito (D25)
- [ ] Parser do CSV (depende do arquivo real: colunas de NSU/bruto/taxa/líquido/data)
- [ ] Migration `AcquirerStatement` + casamento por `(adquirente, NSU, data)` (D22)
- [ ] Tela Conciliação (aba "Conciliado"): 4 estados (D23), com filtro e total por estado
- [ ] Prova: conciliar um dia real e conferir 3 transações na mão contra o portal

## Pendências com o Tarcísio
- [ ] **Credencial do portal** (usuário/senha) OU um **CSV de exemplo** já baixado — sem isso
      não dá para escrever o parser nem testar o coletor
- [ ] Taxas reais para cadastrar: POS por adquirente (Cielo/Rede), PIX TEF (Shipay), PIX estático
