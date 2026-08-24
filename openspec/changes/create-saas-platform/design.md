## Context

O sistema atual (`gdoor-relatorio`) é uma instalação Windows local que serve um dashboard React e expõe uma API Express na própria máquina do cliente, lendo Firebird via `spawn(isql.exe)`. Para acesso remoto, abre tunnel ngrok público. Esse modelo:

- Concentra responsabilidade na máquina do cliente (suporte caro, update manual).
- Tem SQL injection generalizado (queries via string interpolation).
- Expõe banco real sem auth efetiva (middleware existe mas não está registrado em `routes/index.js`).
- Não cresce: 100 clientes = 100 instalações para atualizar uma a uma.

O G-Monitor inverte o modelo: a inteligência fica na nuvem; na máquina do cliente fica apenas um agente leve que executa queries autorizadas no Firebird local quando o backend SaaS demanda.

## Goals / Non-Goals

**Goals:**

- Fundação SaaS multi-tenant completa, com isolamento forte (RLS no Postgres + checagem em código).
- Conexão segura agente↔SaaS via WebSocket TLS outbound, sem porta aberta na loja.
- Eliminação total de SQL injection: queries no agente usam `node-firebird` com prepared statements e o backend SaaS envia parâmetros, não strings.
- Latência aceitável: 80% dos requests servidos do Postgres SaaS (dados sincronizados); somente queries ad-hoc tocam o agente.
- Modo degradado: se o agente cair, dashboard continua respondendo com último snapshot conhecido.
- Auto-update do agente sem intervenção manual do cliente.
- Cobrança recorrente automática via Stripe.

**Non-Goals (MVP):**

- App mobile nativo (web responsivo basta).
- Editor de relatórios customizáveis.
- Integração fiscal (NF-e, SAT) além do que o GDOOR já produz.
- Suporte a outros ERPs além do GDOOR PRO.
- Multi-região com failover global.
- Migração automática do `gdoor-relatorio` para o SaaS — coexistência apenas.

## Architecture Overview

```
┌──────────────────────────┐      ┌──────────────────────────────┐      ┌─────────────────┐
│ Loja do cliente          │      │ VPS BR (G-Monitor SaaS)      │      │ Usuário         │
│                          │      │                              │      │ (web/mobile)    │
│ ┌──────────┐  TCP local  │      │  ┌────────────────────────┐  │ HTTPS│                 │
│ │ Firebird │◄────────────┤      │  │ Frontend (CDN/Nginx)   │◄─┼──────│ Browser         │
│ │  5.0     │             │      │  └────────────────────────┘  │      │                 │
│ └────▲─────┘             │      │            ▲                 │      └─────────────────┘
│      │ node-firebird     │      │            │ /api            │
│ ┌────┴─────┐  WSS        │ ◄────┼──┐  ┌──────┴─────────────┐   │
│ │  Agente  │◄────────────┼──────┼──┼──┤ Fastify backend    │   │
│ │ (NSSM)   │             │      │  │  │ + Prisma + JWT     │   │
│ └──────────┘             │      │  │  └──────┬─────────────┘   │
└──────────────────────────┘      │  │         │                 │
                                  │  │   ┌─────┴──────┐          │
                                  │  └───┤ Redis      │          │
                                  │      │ BullMQ +   │          │
                                  │      │ pub/sub    │          │
                                  │      └─────┬──────┘          │
                                  │            │                 │
                                  │      ┌─────┴──────┐          │
                                  │      │ Postgres   │          │
                                  │      │ multi-tenant + RLS    │
                                  │      └────────────┘          │
                                  │                              │
                                  │  ┌────────────────────────┐  │
                                  │  │ Stripe + Resend +      │  │
                                  │  │ Grafana/Loki/Prom      │  │
                                  │  └────────────────────────┘  │
                                  └──────────────────────────────┘
```

## Decisions

### D1. Agente é Node.js empacotado, não .NET ou Go

- Mantém stack uniforme (TS no backend e no agente, lógica de driver Firebird compartilhada).
- `pkg` produz binário Windows ~40 MB que NSSM transforma em serviço.
- Trade-off: binário maior que Go, mas tempo de desenvolvimento e contratação de devs é muito menor.

### D2. Comunicação agente↔SaaS via WebSocket TLS, não HTTPS long-poll nem gRPC

- WebSocket atravessa NAT/firewall corporativo sem configuração.
- Conexão persistente reduz overhead vs handshake por request.
- Protocolo binário interno (msgpack) sobre WS para payloads grandes.
- Trade-off: gRPC bidi seria mais elegante mas tem mais fricção em proxies corporativos.

### D3. PostgreSQL com Row Level Security, não banco por tenant — hospedado no Supabase (revisado 22/08)

- 1 schema, todas as tabelas com `tenant_id` + policy RLS que filtra por `current_setting('app.tenant_id')`.
- Backups, migrações e operações ficam simples.
- Trade-off: banco por tenant daria isolamento físico mas operação cresceria linearmente. RLS bem-feito é suficiente até dezenas de milhares de tenants.
- **Revisão 22/08:** o Postgres NÃO é mais self-hosted em Docker Compose na VPS — é o Postgres gerenciado do **Supabase** (projeto `G-Monitor`, `sa-east-1`, ref `hpxvzkzjohkrmkgvkiat`). Decisão do dono: menos infra pra manter, e ele já opera Supabase em produção no Ana Food (backups, monitoramento, Management API já dominados). `docker-compose.dev.yml`/`prod.yml` mantêm o serviço `postgres` só como opção de teste local isolado — o banco real (dev/staging/prod, por ora um único ambiente) é o Supabase. Ver D12.

### D4. Sync incremental por checkpoint, não CDC binário do Firebird

- Firebird não tem CDC nativo simples. Agente faz `SELECT ... WHERE ID > checkpoint ORDER BY ID LIMIT 1000` em loop.
- Tabelas sincronizadas: `VENDAS`, `ITEVENDAS`, `MOV_OPERADORES`, `PDV_ESPECIES`, `ESTOQUE`, `CLIENTE(S)`, `FECHAMENTO_CAIXA`, `CONTAS_PAGAR`, `CONTAS_RECEBER` (ver D11).
- Checkpoint local no agente (SQLite) + envio em lote.
- Trade-off: latência de sync = intervalo do tick (ex: 30s). Suficiente para BI; queries que precisam tempo real vão direto ao agente via RPC.

### D5. Auth dupla: JWT para usuários, token long-lived para agentes

- Usuário web: access token (15min) + refresh token (30d, httpOnly cookie) + 2FA TOTP opcional.
- Agente: 1 token por agente, formato `agt_<tenantId>_<uuid>_<secret>`, armazenado encriptado no disco da loja, rotacionável remotamente.
- Token de agente roteia automaticamente: backend extrai `tenantId` do token, autoriza scope.

### D6. RPC tipado, não SQL solto pela conexão

- Backend NÃO envia SQL bruto pela WebSocket. Envia `{op: "report.vendas-dia", params: {data: "2026-05-17"}}`.
- Agente tem catálogo local de queries pré-aprovadas (mapeamento op → SQL com placeholders).
- Catálogo é versionado e assinado; só roda o que o backend autorizou.
- Resultado: mesmo se o canal WS for comprometido, atacante não consegue executar SQL arbitrário no Firebird.

### D7. Modo degradado quando agente offline

- Dashboard sempre primeiro lê do Postgres SaaS (dados sincronizados).
- Indicador na UI mostra "última atualização" + status do agente.
- Operações que exigem o agente (drill-down em vendas hoje, por exemplo) mostram aviso e oferecem retry.

### D8. Stripe Checkout + Customer Portal, não billing custom

- Reduz superfície regulatória (PCI fica com Stripe).
- Webhook Stripe atualiza `subscription_status` no tenant.
- Bloqueio de acesso quando `past_due` por mais de 7 dias.

### D9. Frontend desacoplado do backend, deploy independente

- Build no GitHub Actions, deploy em Nginx do VPS ou CDN.
- Backend serve só `/api/*` e `/ws` (WebSocket dos agentes).
- Permite trocar VPS sem refazer build do front.

### D10. Observabilidade obrigatória desde dia 1

- Logs estruturados com `pino` (JSON), enviados a Loki via Promtail.
- Métricas: latência por endpoint, taxa de erro, conexões WS ativas, queries por agente, lag de sync.
- Alertas: agente offline > 5min, falha Stripe webhook, taxa de erro > 1%.

### D11. Contas a pagar/receber: schema financeiro do GDOOR varia por instalação — CONFIRMADO em produção 22/08

- O `gdoor-relatorio` (sistema legado, mesma base de clientes) já convivia com **duas variantes possíveis** de schema financeiro no Firebird, detectadas em runtime via `tableExists()`.
- **Confirmado ao vivo em 22/08**, contra o Firebird real do cliente piloto (`DATAGES.FDB`, 222k linhas em `VENDAS`, via `RDB$RELATIONS`/`RDB$RELATION_FIELDS`, não suposição):
  - `CONTAS_PAGAR` / `CONTAS_RECEBER` — **não existem** nessa instalação.
  - `PAGAR` / `RECEBER` — **existem**, com colunas ricas o suficiente pra sync completo: `ID` (checkpoint estável), `VENCIMENTO`, `VALOR_DUP` (valor), `PAGAMENTO`/`RECEBIMENTO` (data de baixa), `VALOR_PAG`/`VALOR_REC` (valor baixado), `NOM_FORNECEDOR`/`NOM_CLIENTE` (contraparte), `HISTORICO`, `CANCELADA`. A hipótese anterior (“variante simples, sem ID/contraparte confirmados”) estava errada — vinha de uma leitura só parcial do `gdoor-relatorio` (endpoint de fluxo de caixa usava só 3 colunas dessa tabela, sem esgotar o schema real).
- **Decisão revisada:** o agente detecta qual tabela existe (`RDB$RELATIONS`) no boot e reporta `financialSchema: 'pagar_receber' | 'contas_pagar_receber' | 'none'`. O catálogo/sync agora cobre **as duas variantes**: `pagar_receber` é a primária, confirmada em produção; `contas_pagar_receber` fica como fallback (só inferida do código legado, nenhum cliente real confirmado ainda — pode nem existir de fato, ver Risks).
- **Trade-off:** manter os dois catálogos de SQL (uma constante a mais de manutenção) evita reescrever tudo se aparecer um segundo cliente piloto com a outra variante.

### D12. Supabase: conexão via pooler + Management API como via alternativa, e job de reconciliação

- **Conexão:** a porta direta do Postgres (`db.<ref>.supabase.co:5432`) só resolve em IPv6 — em rede sem saída IPv6 (confirmado nesta VPS: sem rota IPv6, e a porta do pooler IPv4 `aws-0-sa-east-1.pooler.supabase.com:6543` também bloqueada, só HTTPS de saída liberado) é inacessível. Regra: `DATABASE_URL` do backend/Prisma usa o **pooler** (`aws-0-sa-east-1.pooler.supabase.com:6543`, `?pgbouncer=true`, usuário `postgres.<project-ref>`) — funciona de mais lugares que a conexão direta. Se nem o pooler for alcançável (ambiente sem saída de rede em porta de banco, só HTTPS), usar a **Management API** (`https://api.supabase.com/v1/projects/<ref>/database/query` com `SUPABASE_ACCESS_TOKEN` pessoal) pra aplicar SQL — mesmo caminho já usado no Ana Food quando o psql falha. Ver `.env.example`.
- **Job de reconciliação (pedido do dono 22/08):** além do sync incremental de 30s (D4, best-effort — se uma RPC falhar, o delta fica pra trás), roda periodicamente uma comparação "quantas linhas deveriam existir (COUNT no Firebird, por tabela/loja) x quantas existem no Supabase" e reenvia só o que falta. Isso é o item 9.5 (`Reconciliação por COUNT`), ainda não implementado.
  - **Cadência recomendada:** 1h. Justificativa: COUNT é uma query leve no Firebird (não pesa na loja), detecta lacuna rápido sem esperar até a "reconciliação noturna" original, e evita o padrão que já causou incidente de custo no Ana Food (`supabase-egress-incidente-simg-cache` — polling/leitura em excesso gerando custo de egress inesperado). Ajustável por tenant se algum cliente tiver Firebird lento.
  - **Onde roda:** worker BullMQ no backend (mesmo padrão do worker de notificações, `apps/backend/src/workers/`), não no agente — o agente só executa RPC quando solicitado (D6), a decisão de "o que falta" é do backend, que tem visão do que já persistiu.
  - **Como corrige a lacuna:** ao achar `COUNT(Firebird) > COUNT(Supabase)` numa tabela/loja, o backend derruba o checkpoint local daquele agente pra forçar reprocessar a partir de um ID anterior (ou pede um RPC `syncBatch` avulso com range específico) — não um full re-sync da tabela inteira.
- **Ainda não implementado**: este job (worker + endpoint de status + RPC de reconciliação). Ver tasks.md 9.5/9.7.

### D13. Backend piloto saiu da VPS do Ana Food, roda no servidor local do Tarcísio (ms-gestor)

- **Por quê:** a VPS do Ana Food é compartilhada (13+ processos de outro produto) e é uma VM com CPU **steal time de ~40%** (host físico sobrecarregado, fora do controle do Tarcísio) — achado 22/08 ao investigar login/dashboard lentos (>1min). O servidor local (`10.8.0.2`, hostname `servidor`, hardware físico IBM x3100 M4, 4 vCPU dedicados, 0% steal, já usado pra rodar o `ms-gestor`) não tem essa disputa. Login que levava ~5-20s na VPS caiu pra ~1-1.5s no servidor local (mesmo Supabase, mesma rede até ele).
- **Como conecta ao público:** o servidor local não tem IP público (fica atrás de NAT, só alcançável hoje via WireGuard). Em vez de criar um Cloudflare Tunnel novo (o token de API disponível não tinha permissão de conta pra isso), reaproveitou-se a ponte que já existe: o nginx da VPS do Ana Food continua sendo o ponto público (`gmonitor-pilot.anafood.vip`, TLS, DNS — tudo igual), mas o `proxy_pass` de `/api/` e `/ws/agent` aponta pra `http://10.8.0.2:6070` (IP privado do WireGuard) em vez de `127.0.0.1:6070`. O build estático do frontend (`apps/web/dist`) continua servido localmente pela VPS — só a parte pesada (banco, sync) saiu de lá. Hostname do agente **não mudou** — ele reconectou sozinho sem precisar trocar `agent.json`.
- **Achado de infra**: nesse servidor, `pnpm exec <bin>` (prisma, tsc, vite) trava/retorna vazio silenciosamente — build precisa invocar o `.js` do pacote direto via `node .../node_modules/<pkg>/bin-ou-build/index.js` (mesmo padrão já documentado nas memórias do ms-gestor pra `npx tsc`). E `pnpm` sozinho trava esperando um prompt de telemetria em sessão não-interativa — precisa `CI=true` no ambiente.
- **O que ficou na VPS do Ana Food**: só o nginx (proxy fino) + o build estático do web. Removido: processo PM2 do backend, container Redis dedicado, containers/volumes docker órfãos de tentativas anteriores (postgres local descartado quando a decisão virou Supabase, ver D3/D12), `.env` com segredos (não é mais usado lá).

### D14. Sync de volume grande (backfill de loja nova): bulk upsert em vez de linha-a-linha, pool dedicado

- **Problema, medido ao vivo no incidente de 24/08:** ao ligar sync de itens de venda/pagamentos, `ITEVENDAS` tinha 652.422 linhas e `MOV_OPERADORES` 194.911 (uma única loja piloto). Cada upsert via Prisma paga ~180ms de RTT até o Supabase (sa-east-1). Mesmo depois de reduzir lote (1000→200), concorrência (6→2) e alargar o intervalo (30s→90s), o volume ainda derrubava `/api/reports/*` pro usuário com `P1001 Can't reach database server` — não era fila lenta, era o **pooler do Supabase sem slot de conexão disponível** (connection_limit=15 compartilhado entre sync e as leituras normais do dashboard). Isolado com teste real: agente parado = 0 erro em 120 chamadas; agente sincronizando essas 2 tabelas = erro real volta. Decisão tomada no incidente: desligar essa sincronização até ter uma estratégia que não seja 1 round-trip de rede por linha (ver `SYNC_SALE_ITEMS_AND_PAYMENTS_ENABLED=false` em `syncer.ts`).
- **Causa raiz:** o sync (`syncRoutes.ts`) faz `mapWithConcurrency(rows, N, upsertUmaLinha)` — reduzir `N` (concorrência) ou o tamanho do lote só desloca o gargalo, não resolve: o custo total continua sendo **N linhas × 1 round-trip cada**, só que espalhado no tempo. Pra 652 mil linhas a ~180ms/round-trip, mesmo com paralelismo perfeito isso é várias horas de conexões abertas simultâneas competindo com o resto do app — e esse é exatamente o caso que **toda loja nova** vai bater no dia 1 (backfill completo do histórico, não só esse piloto).
- **Decisão: 3 mudanças, complementares:**
  1. **Bulk upsert multi-linha** — trocar N chamadas Prisma individuais por `INSERT ... VALUES (...), (...), ... ON CONFLICT (tenant_id, store_id, source_id) DO UPDATE SET ...` em lotes de ~500 linhas por statement (via `$executeRaw`, Postgres aceita bem acima disso em parâmetros por statement). Isso troca **N round-trips por N/500** — pra 652 mil linhas, ~1300 statements em vez de ~3260 lotes de 200 upserts individuais cada. O tempo de rede deixa de dominar; o gargalo vira o throughput de escrita do próprio Postgres, que é ordens de magnitude maior.
  2. **Pool de conexão separado pra sync** — hoje sync-write e report-read disputam o mesmo `connection_limit=15` de uma única `PrismaClient`. Criar uma segunda instância (`prismaSync`) com um `connection_limit` pequeno e fixo (ex: 3-5) dedicado só ao endpoint `/api/agent/sync`, deixando o pool "principal" livre pras telas do usuário — isola estruturalmente, não depende de nunca errar o ajuste de concorrência de novo.
  3. **Lote adaptativo por tamanho de backlog, mesmo código pra loja nova e sync incremental** — em vez de duas implementações (uma pra "backfill inicial", outra pra "trickle do dia a dia"), o agente calcula `backlog = maxIdConhecido - checkpoint` e escala o lote (grande quando o backlog é grande — caso de loja nova sincronizando desde o começo — pequeno quando já está em dia). Com bulk upsert (item 1), lotes grandes deixam de ser perigosos.
- **Visibilidade pro dono/cliente:** loja nova com backfill grande não deve parecer travada — expor no `/api/agents` (ou nos meta dos relatórios) algo como `backfillProgress: { table, syncedSoFar, estimatedTotal }`, calculado a partir do checkpoint vs. `MAX(ID)` já conhecido, pra UI mostrar "sincronizando histórico: 45%" em vez de tela vazia sem explicação.
- **Ainda não implementado** — este é o desenho aprovado pelo dono (24/08) pra retomar saleItems/payments e pra qualquer backfill grande futuro (loja nova). Prioridade alta: sem isso, todo cliente novo bate no mesmo incidente no primeiro dia de uso.

## Risks / Trade-offs

| Risco | Mitigação |
|-------|-----------|
| Latência ida-e-volta SaaS↔agente | Cache agressivo do Postgres SaaS + sync incremental cobre 80% das telas |
| Internet do cliente cai = dashboard cai | Modo degradado servindo último snapshot; alerta visual |
| LGPD: dados em VPS fora da loja | Contrato de processamento + criptografia em repouso + região BR + DPO documentado |
| Versão Firebird varia por cliente (2.5, 3.0, 4.0, 5.0) | Agente detecta versão no boot e usa driver compatível (`node-firebird` suporta todas) |
| Update do agente quebra cliente | Rollout em ondas (canary 5% → 25% → 100%) + rollback automático em telemetria ruim |
| Migração de tenant existente para novo schema | Migrações Prisma com `prisma migrate deploy` versionadas + downtime planejado |
| Stripe webhook falha = cliente paga e fica bloqueado | Job idempotente que reconcilia `subscription_status` a cada hora |
| Custo de infra cresce mais rápido que receita | Métricas de unit economics por tenant desde o início; reajuste de plano se necessário |
| Nome/coluna da tabela financeira (contas a pagar/receber) varia entre instalações GDOOR | Detecção de schema em runtime (D11); `PAGAR`/`RECEBER` confirmada em produção 22/08, catálogo cobre as duas variantes; `CONTAS_PAGAR`/`CONTAS_RECEBER` segue sem nenhum cliente real confirmado — pode ser só suposição do código legado |

## Migration Strategy

`gdoor-relatorio` (sistema atual) permanece intacto. Clientes existentes continuam usando até decidirem migrar. A migração de um cliente para o G-Monitor envolve:

1. Criar tenant no SaaS (admin do G-Monitor).
2. Gerar token de agente e enviar instalador parametrizado.
3. Cliente instala agente na máquina onde o Firebird roda (mesma máquina onde hoje roda o `gdoor-relatorio` server).
4. Agente conecta, executa sync inicial completa (pode levar minutos em base grande).
5. Cliente recebe URL `https://app.gmonitor.com.br` e credenciais.
6. Cliente decide quando desligar o `gdoor-relatorio` legado.

Não há migração de dados do legado para o SaaS — o agente lê direto do Firebird, mesma fonte da verdade.

## Open Questions

- Forçar 2FA para owners desde dia 1 ou só recomendar no MVP? **Recomendação:** obrigatório para `owner`, opcional para outros papéis.
- Preço inicial do plano? **Decisão fora de spec** — vai em documento separado.
- Onde hospedar (Hetzner DE BR? Hostinger BR? AWS São Paulo?)? **Decisão de infra** — começar Hetzner ou Hostinger por custo, migrar se necessário.
- Bundle do agente inclui auto-instalador NSSM ou pede `sc.exe`? **Decisão de implementação** — incluir NSSM bundled no instalador Inno Setup.
