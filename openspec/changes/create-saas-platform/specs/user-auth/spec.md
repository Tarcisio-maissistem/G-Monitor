## ADDED Requirements

### Requirement: Login com email e senha
Usuários acessam a plataforma com email + senha, opcionalmente protegidos por 2FA TOTP.

#### Scenario: Login válido emite tokens
- **WHEN** um usuário ativo envia email e senha corretos
- **THEN** recebe um access token JWT (15min) e um refresh token (30d, httpOnly cookie, secure, sameSite=lax)

#### Scenario: Login com 2FA exige código adicional
- **WHEN** o usuário tem 2FA habilitado e envia credenciais válidas sem código TOTP
- **THEN** o sistema responde com challenge `2fa_required` exigindo o código antes de emitir tokens

#### Scenario: Senha incorreta não revela existência do email
- **WHEN** o email não existe ou a senha está errada
- **THEN** a resposta é idêntica em ambos os casos: "credenciais inválidas"

### Requirement: Rate limit em autenticação
Tentativas excessivas de login são limitadas para prevenir brute force.

#### Scenario: Cinco falhas em cinco minutos travam o email
- **WHEN** ocorrem 5 tentativas falhas para o mesmo email em até 5 minutos
- **THEN** novas tentativas para esse email são bloqueadas por 15 minutos, independente do IP

#### Scenario: Captcha após bloqueio
- **WHEN** o usuário tenta logar imediatamente após o desbloqueio
- **THEN** é exigido captcha por mais 1 hora

### Requirement: Rotação de refresh token
Refresh tokens são rotacionados a cada uso para detectar reuso (sinal de roubo).

#### Scenario: Refresh emite novo par de tokens
- **WHEN** um refresh token válido é apresentado
- **THEN** ele é invalidado e um novo par (access + refresh) é emitido

#### Scenario: Reuso de refresh dispara revogação global
- **WHEN** um refresh token já usado é apresentado novamente
- **THEN** todos os refresh tokens do usuário são revogados, o usuário é forçado a logar novamente, um evento de segurança é registrado

### Requirement: Papéis e permissões
Cada usuário tem exatamente um papel por tenant: `owner`, `admin`, `gestor`, `operador` ou `leitor`.

#### Scenario: Owner é único e não pode ser removido sem sucessão
- **WHEN** o owner tenta sair do tenant sem promover outro usuário a owner
- **THEN** a operação é rejeitada com mensagem orientando a transferir o papel primeiro

#### Scenario: Operador acessa apenas sua loja
- **WHEN** um operador vinculado à loja X solicita relatórios
- **THEN** apenas dados da loja X retornam, mesmo se ele solicitar `storeId` diferente

### Requirement: 2FA TOTP obrigatório para owner
Owners não podem desabilitar 2FA após a primeira ativação. Para outros papéis, é opcional.

#### Scenario: Owner ativa 2FA no onboarding
- **WHEN** o owner conclui o cadastro
- **THEN** na primeira sessão é exibido fluxo obrigatório de ativação de 2FA com QR code e códigos de recuperação

#### Scenario: Owner não consegue desabilitar 2FA
- **WHEN** o owner tenta desativar 2FA
- **THEN** a ação é bloqueada com mensagem explicando o motivo

### Requirement: Sessão persistida em cookie httpOnly
Tokens não são acessíveis a JavaScript da página para evitar XSS.

#### Scenario: Refresh token está em cookie seguro
- **WHEN** o usuário faz login
- **THEN** o refresh token é entregue em cookie `httpOnly`, `secure`, `sameSite=lax`, `path=/api/auth`

### Requirement: Logout revoga refresh token
Logout invalida o refresh token atual no servidor.

#### Scenario: Logout limpa estado
- **WHEN** o usuário chama `/api/auth/logout`
- **THEN** o refresh é revogado no banco, o cookie é removido e tokens emitidos previamente não podem mais renovar
