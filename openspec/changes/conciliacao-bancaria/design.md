# Design — Conciliação bancária

## D21 — A taxa é cadastrada no G-Monitor, não lida do GDOOR

`TAXAS_CARTAO` do cliente tem as 10 linhas com `TAXA = 0%`: o campo existe mas ninguém
preencheu. Ler dali daria líquido = bruto, um número errado com cara de certo. **Decisão:**
a taxa vem de uma tabela própria do G-Monitor (`FeeRule`), cadastrada pelo lojista. Se um
dia o GDOOR passar a ter taxa real, ela vira sugestão de preenchimento — nunca fonte
silenciosa.

## D22 — Chave de conciliação = NSU (+ data, + valor como desempate)

100% das 8.561 transações têm NSU. O casamento é `NSU + data` e o valor confirma. NSU pode
repetir entre adquirentes diferentes (é sequencial por terminal), então a chave real é
`(adquirente, NSU, data)`. Casamento por valor+data sozinho seria ambíguo — duas compras de
R$ 4,99 no mesmo dia são indistinguíveis.

## D23 — Quatro estados de conciliação, nenhum deles "sumiu"

| Estado | Significa | Ação do lojista |
|---|---|---|
| `conciliado` | NSU no GDOOR e no extrato, valores iguais | nada |
| `nao_repassado` | está no GDOOR, **não** está no extrato | cobrar a adquirente |
| `so_no_extrato` | está no extrato, não está no GDOOR | venda fora do sistema / erro de registro |
| `taxa_divergente` | casou, mas a taxa cobrada ≠ cadastrada | revisar contrato |

`nao_repassado` só é confiável quando o extrato **cobre o período inteiro** da comparação —
senão toda venda de ontem apareceria como não repassada. Por isso o resultado guarda a
janela de datas do extrato e a tela recusa comparar fora dela.

## D24 — Credencial do portal cifrada (AES-256-GCM), nunca em tela

O G-Monitor **não tinha** padrão de cifra: senha nenhuma era guardada até agora. Esta é a
primeira. Reusa o desenho já validado no Ana Food (`src/lib/secretBox.js`): formato
`v1:<iv>:<tag>:<ciphertext>`, chave só em `INTEGRACAO_ENC_KEY` no `.env` do backend —
**nunca no banco** (guardar a chave junto do que ela cifra anula a cifra). GCM e não CBC:
se o texto cifrado for adulterado, `open()` falha em vez de devolver lixo.

A API **nunca devolve a senha**, nem mascarada: devolve só `temSenha: true|false`. A tela
mostra "senha salva" e um botão de trocar.

## D25 — Coleta do portal: sessão + CSRF, com falha explícita

O portal é CodeIgniter: `csrf_cookie_name` + `ci_session_1`, e a rota de relatório
redireciona para login quando a sessão morre. O coletor:
1. GET na página de login → captura cookie CSRF
2. POST das credenciais → guarda a sessão
3. POST/GET do filtro de datas → baixa o CSV
4. Se voltar HTML de login em vez de CSV → erro `credencial_invalida` **explícito**

Nunca "silencia" um HTML de login virando CSV vazio — isso apareceria como "nenhuma
transação no extrato" e acusaria a adquirente injustamente. A coleta é **sob demanda**
(botão "Buscar extrato"), não um cron: raspagem autenticada agendada é o tipo de coisa que
quebra sem ninguém ver.

## Modelo de dados (novas tabelas)

```prisma
model CardTransaction {        // espelho de MOVIMENTACAO_CARTAO (Fase 1)
  sourceId      String         // MOVIMENTACAO_CARTAO.ID
  acquirer      String?        // BANDEIRA (REDE/CIELO)
  nsu           String?
  authCode      String?
  value         Decimal
  installments  Int?
  transactionAt DateTime       // DATA + HORA
  kind          String?        // TIPO_TRANSACAO (10/20 -> debito/credito)
  paymentSourceId String?      // via VENDA_PAGAMENTO_CARTAO -> MOV_OPERADORES.ID
  @@unique([tenantId, storeId, sourceId])
}

model FeeRule {                // taxa cadastrada pelo lojista (Fase 2)
  channel     String           // 'pos' | 'pix_tef' | 'pix_estatico'
  acquirer    String?          // null = vale para qualquer adquirente
  kind        String?          // 'debito' | 'credito' | null
  installments Int?            // null = qualquer
  percent     Decimal          // taxa %
  fixedValue  Decimal @default(0)
  daysToReceive Int   @default(1)
}

model AcquirerStatement {      // linha do CSV do portal (Fase 3)
  source      String           // 'portal_tef'
  nsu         String?
  grossValue  Decimal
  netValue    Decimal?
  feeValue    Decimal?
  capturedAt  DateTime
  @@unique([tenantId, storeId, source, nsu, capturedAt])
}
```

## Como a taxa é escolhida (mais específica ganha)

`acquirer + kind + installments` → `acquirer + kind` → `acquirer` → `channel` (curinga).
Sem regra que sirva, a transação aparece como **"sem taxa cadastrada"** e fica FORA do
total de líquido previsto — não entra como taxa zero, que mentiria para cima.

## D26 — Portal GetCard MAPEADO e validado (27/08, com credencial do dono)

O portal **não** tem API nem CSV no servidor: o botão CSV é do DataTables (gera no navegador).
Mas a tabela é **renderizada no servidor**, então a coleta é HTTP puro — sem navegador headless
no VPS. Fluxo validado ponta a ponta com `curl`:

1. `GET /index.php/admin/a/login?code=GETCARD` → cookies `csrf_cookie_name` + `ci_session_1`
   e o token em `<input name="csrf_test_name">`.
2. `POST` no mesmo URL com `csrf_test_name`, `user` (CNPJ só dígitos), `password` → sessão.
3. `POST /index.php/admin/vendas/filtroTodasAsVendas` com `csrf_test_name`,
   `periodo=DD/MM/AAAA - DD/MM/AAAA`, `numeroRegistro=100` (máximo do select) → HTML com a tabela.
4. Paginação por **GET** na mesma rota:
   `?&periodo=...&numeroRegistro=100&ordernar2=crescente&ordernar1=nsu&page=N`.
   O último `page=N` do bloco `<ul class="pagination">` dá o total de páginas
   (01–27/08 = 29 páginas ≈ 2.900 linhas).

**14 colunas da tabela:** `# | PDV | NSU | Cartão/Tipo | Tipo do Cartão | Parc. | R$ |
Adquir./Bandeira | Data da Msg | D/H Estabelecimento | Controle | NSU Host | Autoriza. |
Status/Resp.`

Detalhes que o parser precisa tratar:
- `Adquir./Bandeira` vem **concatenado** sem separador: `CIELOELO CREDITO`, `REDEMASTERCARD DEB`.
  Adquirente é o prefixo (`CIELO`/`REDE`); o resto é a bandeira.
- `Cartão/Tipo` idem: `650597-2974Crédito à Vista`.
- `R$` no formato brasileiro (`1.234,56`).
- `NSU Host` só vem preenchido na REDE; na CIELO fica vazio.
- Status observado: `Autorizadas000` (o painel também tem Negado/Cancelado).

## D27 — CORRIGIDO: o portal casa com TEF CREDITO + TEF DEBITO (não com MOVIMENTACAO_CARTAO)

**Erro cometido e corrigido em 27/08:** a primeira comparação usou `MOVIMENTACAO_CARTAO`
(1.256 linhas / R$131.553 em agosto) e concluiu que "o portal tem o dobro do GDOOR". Errado —
tabela errada. O portal GetCard corresponde às formas **`TEF CREDITO` + `TEF DEBITO`** em
`MOV_OPERADORES`. É a mesma armadilha já registrada no CLAUDE.md: conferir a fonte certa
ANTES de afirmar.

Comparação correta, dia a dia, 01–26/08/2026:

| | Transações | Valor |
|---|---|---|
| Portal GetCard (autorizadas, PDV 001+002) | 2.636 | R$ 269.201,35 |
| GDOOR `TEF CREDITO + TEF DEBITO` | 2.454 | R$ 254.786,63 |

**De 01/08 a 23/08 os dois lados batem — em 18 dos 23 dias a diferença é R$ 0,00**, incluindo
a contagem de transações. Isso VALIDA o modelo de conciliação.

A diferença total de R$ 14.414,72 se decompõe assim:
- **R$ 13.720,42 (95%) = cópia local desatualizada.** O banco em 10.8.0.4 é de "ontem"
  (informado pelo dono): 25 e 26/08 têm ZERO no GDOOR e 24/08 está parcial (57 de 103).
- **R$ 694,30 (5%) = divergência real**, concentrada em 5 dias: 03/08 (+7,73), 05/08 (+212,17),
  21/08 (+140,76), 22/08 (+407,23) e 23/08 (−73,59 — aqui o GDOOR tem uma transação a MAIS).

Ou seja: a venda que passa na maquininha fora do sistema existe, mas é da ordem de **R$ 700 no
mês**, não de dezenas de milhares. É exatamente o tamanho de achado que só a conciliação revela.

**Consequências de desenho:**
1. A conciliação compara contra `MOV_OPERADORES` (TEF), não `MOVIMENTACAO_CARTAO`.
2. Comparar dia com sincronização incompleta gera falso "não repassado" — por isso o resultado
   só considera dias em que o agente já sincronizou (D23 já previa isso; aqui ficou provado).
3. O casamento por dia+total já resolve 95% dos casos; o NSU serve para APONTAR qual transação
   divergiu nos 5 dias com diferença.

## D28 — SHIPAY é o PIX do TEF

`MOVIMENTACAO_CARTAO.BANDEIRA` tem `SHIPAY` (45 transações em agosto), que bate com as 48
transações de `pix_tef` contadas pelo `feeChannel()`. Confirma o mapeamento do canal.
