# G-Monitor — Contexto do Projeto

## Visão

Plataforma SaaS multi-tenant que entrega BI gerencial em tempo real para varejistas usuários do ERP/PDV GDOOR PRO, sem expor o banco Firebird local à internet.

## Problema

- Sistema atual (`gdoor-relatorio`) é instalação local por cliente, com SQL injection, ngrok público, auth fraca e operação por loja.
- Não há base recorrente (MRR), suporte é cliente a cliente, update é manual.
- Crescimento exige modelo que escala: 1 plataforma → N clientes → N lojas.

## Solução

- VPS hospeda backend SaaS + Postgres + Redis + frontend.
- Agente leve Windows (Node.js empacotado) é instalado na máquina da loja onde roda o Firebird.
- Agente abre WebSocket outbound TLS para SaaS, mantém conexão viva.
- SaaS roteia requests autenticadas para o agente certo via tenant_id.
- Agente executa queries com `node-firebird` (driver nativo, prepared statements).
- Sync incremental empurra agregados para Postgres SaaS — dashboard responde sem ida ao agente em 80% dos casos.

## Personas

- **Owner do tenant:** dono do negócio, vê dashboard consolidado, gere usuários, contrata plano.
- **Gestor:** acompanha indicadores diários, recebe alertas.
- **Operador:** acesso restrito a sua loja/PDV.
- **Leitor (contador, sócio):** somente leitura.

## Princípios

1. Segurança primeiro: zero SQL injection, segredos fora do repositório, RLS no Postgres.
2. Outbound only: agente nunca abre porta. Internet do cliente cai = modo degradado, não erro.
3. Especificação antes do código: toda capability tem spec em `openspec/specs/`.
4. Observabilidade desde o dia zero: agente reporta saúde, query lenta, erros.
5. Multi-tenant nativo: nenhuma feature ignora `tenant_id`.

## Stack confirmada

- Backend: Node.js 20 + TypeScript + Fastify + Prisma
- Banco SaaS: PostgreSQL 16 com RLS
- Cache/Fila: Redis 7 + BullMQ
- Frontend: React 18 + Vite + Tailwind + TanStack Query
- Agente: Node.js 20 + TypeScript + `node-firebird` + `ws`, empacotado com `pkg`, serviço Windows via NSSM
- Auth: JWT (jose), 2FA TOTP (otplib), token de agente long-lived rotacionável
- Pagamento: Stripe (assinaturas + portal de cliente)
- Email: Resend ou Postmark
- Observabilidade: pino + Loki + Prometheus + Grafana
- VPS: Hostinger/Hetzner/DigitalOcean BR, Docker Compose para começar

## Não-objetivos do MVP

- App mobile nativo (web responsivo basta)
- Editor de relatórios customizáveis (apenas relatórios pré-definidos)
- Integração com fiscais (NF-e, SAT) — só leitura do que o GDOOR já gera
- Suporte a outros ERPs além do GDOOR PRO
- Multi-região / alta disponibilidade global

## Glossário

- **Tenant:** organização cliente (uma empresa/grupo que paga assinatura).
- **Loja:** ponto físico do tenant. 1 loja = 1 instalação do agente = 1 Firebird.
- **Agente:** serviço Windows instalado na loja, ponte com Firebird local.
- **RPC:** chamada remota tipada, transportada via WebSocket entre SaaS e agente.
- **CDC:** Change Data Capture — sync incremental por checkpoint de ID/timestamp.
- **Capability:** uma especificação de comportamento em `openspec/specs/<name>/spec.md`.
