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

### D3. PostgreSQL com Row Level Security, não banco por tenant

- 1 schema, todas as tabelas com `tenant_id` + policy RLS que filtra por `current_setting('app.tenant_id')`.
- Backups, migrações e operações ficam simples.
- Trade-off: banco por tenant daria isolamento físico mas operação cresceria linearmente. RLS bem-feito é suficiente até dezenas de milhares de tenants.

### D4. Sync incremental por checkpoint, não CDC binário do Firebird

- Firebird não tem CDC nativo simples. Agente faz `SELECT ... WHERE ID > checkpoint ORDER BY ID LIMIT 1000` em loop.
- Tabelas sincronizadas: `VENDAS`, `ITEVENDAS`, `MOV_OPERADORES`, `PDV_ESPECIES`, `ESTOQUE`, `CLIENTE(S)`, `FECHAMENTO_CAIXA`.
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
