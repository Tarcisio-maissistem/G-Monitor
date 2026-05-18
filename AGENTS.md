# Guia para Agentes (Claude / Cursor / Codex / etc.)

Projeto **G-Monitor** — SaaS multi-tenant para BI gerencial.

## Antes de qualquer alteração

1. Leia `openspec/project.md` (contexto, personas, stack).
2. Leia o `proposal.md` e `design.md` do change ativo em `openspec/changes/`.
3. Verifique se a alteração que vai fazer toca uma capability existente. Se sim, leia o `spec.md` correspondente.

## Fluxo de trabalho com OpenSpec

1. Toda nova feature começa como um **change** em `openspec/changes/<kebab-case-name>/`.
2. Um change contém: `proposal.md`, `design.md`, `tasks.md` e `specs/<capability>/spec.md` para cada capability afetada.
3. Implementação só começa após o change ter sido revisado e aprovado.
4. Ao concluir um change, arquive-o; specs migram para `openspec/specs/`.

## Diretrizes de código

- Linguagem: **TypeScript** em todo lugar (backend, agente, web, contratos).
- Identificadores técnicos em inglês; conteúdo voltado ao usuário em português pt-BR.
- Nada de SQL por string interpolation — sempre prepared statements via `node-firebird`.
- Toda query do agente deve estar no catálogo assinado; nunca aceitar SQL bruto da rede.
- Toda escrita no Postgres SaaS deve respeitar `tenant_id` e estar protegida por RLS.
- Validação de input com Zod em todos os endpoints públicos.
- Logs em JSON via `pino`; nunca logar senha, token ou refresh.

## Diretrizes de spec

- Specs descrevem **comportamento observável**, não implementação.
- Detalhes técnicos vão em `design.md` e `tasks.md`.
- Cada requirement tem ao menos um scenario; cobrir caso feliz, erro previsível e edge case.
- Specs que envolvem dados devem mencionar isolamento multi-tenant.

## Diretrizes de commits

- Conventional Commits (`feat:`, `fix:`, `chore:`, etc.).
- Mensagem em português, escopo entre parênteses (`feat(agent): adiciona reconexão`).
- Não criar commit sem rodar lint e testes localmente.

## Quando em dúvida

Pergunte. É melhor 1 minuto de pergunta que 1 hora de retrabalho. Em particular para:

- Decisões de schema do banco multi-tenant.
- Mudanças no protocolo RPC agente↔SaaS (versionamento).
- Qualquer coisa que toque segurança (auth, tokens, criptografia).
