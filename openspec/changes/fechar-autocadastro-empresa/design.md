# Design

## Backend
`apps/backend/src/auth/routes.ts`: **remover** a rota `POST /api/auth/signup` e o
`signupSchema`. Rota inexistente responde 404 — não fica endpoint "desligado" por flag que
alguém religa sem perceber.

Nada mais do fluxo é apagado:
- `pendingApproval` continua no schema e na tela (as 5 empresas de QA ficaram com ele true,
  e o histórico precisa continuar legível).
- A notificação `signup_pending` e o botão "Aprovar" continuam — empresa criada pelo admin
  nasce aprovada, mas o tipo segue válido para o histórico já gravado.

## Web
`apps/web/src/pages/LoginPage.tsx`: some o modo `signup`/`signup-done`, os componentes
`SignupForm`/`SignupDone` e o botão "Cadastrar minha empresa". A tela fica só com o login.

## Por que remover em vez de bloquear por papel
Pôr `requireSuperAdmin` no `/api/auth/signup` criaria DOIS caminhos de criação de empresa
(esse e `/api/admin/tenants`), com regras diferentes — o do auth nasce `pendingApproval=true`
e sem auditoria. Caminho único é o que impede a divergência voltar.

## Prova
- Teste novo: `POST /api/auth/signup` responde **404**.
- Teste novo: `POST /api/admin/tenants` **sem** token de super-admin é recusado.
- Build do web sem o `SignupForm` (typecheck).
