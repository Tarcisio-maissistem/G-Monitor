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

## D27 — O portal cobre 2 PDVs; o GDOOR do PC cobre menos

Comparação do MESMO dia (06/08/2026), medida nos dois lados:

| Fonte | Transações | Valor |
|---|---|---|
| Portal GetCard (PDV 001 + 002) | 97 (56 + 41) | R$ 8.528,12 |
| GDOOR `MOVIMENTACAO_CARTAO` (10.8.0.4) | 43 (CIELO 20, REDE 21, SHIPAY 2) | R$ 4.781,43 |

O portal tem **mais que o dobro**. Também não houve casamento por valor+data nas 4 amostras
testadas. Isso NÃO invalida a conciliação — é exatamente o que ela existe para revelar. As
hipóteses (a confirmar com o dono, não afirmar): o PDV 002 não está integrado ao GDOOR desta
máquina, ou há venda passada direto na maquininha sem entrar no sistema. Antes de acusar
qualquer lado, a Fase 3 deve conciliar **por PDV**, não no total.

Consequência de desenho: `AcquirerStatement` guarda o **PDV** e o casamento é
`(pdv, adquirente, NSU, data)`. Sem o PDV, PDV 001 e 002 embaralham NSU (ambos começam em
`001001`) e a conciliação daria falso positivo.

## D28 — SHIPAY é o PIX do TEF

`MOVIMENTACAO_CARTAO.BANDEIRA` tem `SHIPAY` (45 transações em agosto), que bate com as 48
transações de `pix_tef` contadas pelo `feeChannel()`. Confirma o mapeamento do canal.
