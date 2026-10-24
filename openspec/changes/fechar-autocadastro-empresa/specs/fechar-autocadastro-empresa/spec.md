# Só o dono cadastra empresa

## ADDED Requirements

### Requirement: Não existe cadastro público de empresa
O sistema MUST NOT expor qualquer endpoint que crie empresa sem autenticação. Criar empresa
MUST exigir um usuário com `isSuperAdmin = true` e MUST ser registrado em auditoria.

#### Scenario: Tentativa de autocadastro
- **WHEN** alguém chama `POST /api/auth/signup`
- **THEN** a resposta é 404 e nenhuma empresa é criada

#### Scenario: Criação sem ser super-admin
- **WHEN** um usuário comum chama `POST /api/admin/tenants`
- **THEN** a chamada é recusada

### Requirement: A tela de login não oferece cadastro
A tela de login MUST NOT exibir caminho para cadastrar empresa.

#### Scenario: Tela de login
- **WHEN** a tela de login é aberta
- **THEN** só há o formulário de entrar — nenhum botão de cadastro
