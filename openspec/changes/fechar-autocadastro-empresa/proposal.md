# Proposta — só o dono cadastra empresa

## Problema
Em 21/10 apareceram 5 empresas que o dono não reconheceu ("QA Oracle", "QA Oracle 2",
"QA Teste <CNPJ>" e uma com o nome/CNPJ reais da Mais Sistem). A investigação mostrou que
vieram de uma rodada de QA entre 09h40 e 12h40, por contas `@testequalidade.app`, usando o
**autocadastro público** `POST /api/auth/signup` — que cria empresa + usuário **sem login
nenhum**. Nenhuma operou (todas pendentes, zero agentes), mas a porta está aberta para
qualquer pessoa na internet.

Decisão do dono (24/10): **só ele cadastra empresa**.

## Objetivo
- Fechar o autocadastro público: criar empresa passa a exigir login de super-admin.
- Tirar "Cadastrar minha empresa" da tela de login.

## O que JÁ existe e não será reconstruído
Conferido no código antes de propor:
- `POST /api/admin/tenants` — criação de empresa **restrita a super-admin**, com auditoria.
- Super-admin **já acessa todas as empresas** (decisão do dono 23/08, `admin/routes.ts`).
- `EmpresaSelectPage` + `TenantSelector` — **seleção de empresa após o login** (pedido do
  dono 26/08) e `POST /api/admin/tenants/:id/switch` para trocar.
Ou seja, o pedido "meu login acessa tudo e eu escolho a empresa" já está pronto. Só falta
fechar a porta.

## Fora de escopo
`POST /api/agents/register-by-cnpj` (público de propósito: é como o instalador troca o CNPJ
por um token de agente numa empresa que JÁ existe — não cria empresa). Mexer nele quebraria
instalação de agente em cliente real.

## Risco
Quem hoje se cadastraria sozinho passa a depender do dono. É exatamente o pedido.
