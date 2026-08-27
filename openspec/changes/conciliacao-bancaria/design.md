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
