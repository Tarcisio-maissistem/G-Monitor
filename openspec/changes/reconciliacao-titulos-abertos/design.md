# Design — Reconciliação de títulos em aberto

## Fluxo

```
agente (tick, a cada 6h)
  │
  ├─1─> GET /api/agent/open-titles            (nuvem: "estes eu ainda acho em aberto")
  │        -> { payables: [sourceId...], receivables: [...] }
  │
  ├─2─> Firebird: reconcile-{payables,receivables}-<variante>  WHERE ID IN (?,?,…)
  │        em lotes de 200 ids (limite de parâmetros do Firebird)
  │
  └─3─> POST /api/agent/sync  { table, rows, recent: true }    (upsert; NÃO move checkpoint)
```

## D1 — Quem define "em aberto" é a nuvem, não uma data

`paidValue < value AND cancelled = false AND dueDate <= hoje + 30 dias`.

- `paidValue < value` é a mesma condição que o backend já usa para *não* classificar como `paid`
  (`financeList`/`classifyFinanceStatus`) — reusar a regra evita duas verdades.
- O teto `hoje + 30 dias` evita arrastar parcelamento longo a cada ciclo: há títulos com vencimento
  em **2029 e 2055** nesse cliente. Os 30 dias de folga cobrem baixa adiantada; o resto chega pela
  janela recente quando o vencimento se aproxima.
- Prisma não compara duas colunas em `where`, então a consulta é `$queryRaw` (mesmo padrão já usado
  em `financeList`).
- Teto de 1.000 ids por tabela, `ORDER BY dueDate DESC` (o mais recente primeiro, que é o que o
  lojista está olhando). Acima disso, o ciclo seguinte pega o resto — convergência em vez de
  tentar resolver tudo num tick.

## D2 — SQL continua na allowlist

O catálogo é a fronteira de segurança ("o agente SOMENTE executa queries deste catálogo"). As novas
entradas têm o marcador `{{IDS}}` no template e `resolveReportComIds(id, n)` o expande para
exatamente `n` placeholders `?`. **Os ids vão como parâmetros posicionais, nunca interpolados** —
não há concatenação de valor em SQL.

## D3 — As quatro entradas, não duas

`reconcile-payables-pagar`, `reconcile-payables-contas-pagar`, `reconcile-receivables-receber`,
`reconcile-receivables-contas-receber`. A variante é escolhida por `detectFinancialSchema()`, igual
ao resto do syncer. Isso fecha o furo 3 da proposal: a instalação `CONTAS_PAGAR` passa a ter
atualização de baixa (hoje não tem nenhuma).

## D4 — Reaproveita o caminho de escrita que já existe

`postBatch(..., recent = true)`: a nuvem faz upsert por `sourceId` e **não avança o checkpoint** nem
freia o backfill. Nada de endpoint de escrita novo.

## D5 — Custo e ritmo

Mesmo throttle da janela recente (`podeRodarRecente`, 6h) e só quando a tabela está `emDia` (fora de
backfill). No cliente real: 20 + 111 ids = 1 requisição à nuvem + 1 consulta ao Firebird por tabela.

## D6 — Falha não propaga

Erro na reconciliação é `logger.warn` e segue no próximo tick, igual à janela recente. Nenhuma baixa
é inventada: se o Firebird devolve `PAGAMENTO` nulo, o título continua em aberto — a nuvem só espelha.

## Observabilidade (lacuna achada no diagnóstico)

O agente não reporta qual variante de schema detectou; `agents` só guarda `agentVersion` e
`firebirdVersion`. Por isso não foi possível provar pela nuvem qual variante o J.Kastros usa.
Passa a enviar `x-agent-financial-schema` no header do sync e o backend grava em
`Agent.financialSchema` — diagnóstico futuro sem precisar de acesso à máquina do cliente.
