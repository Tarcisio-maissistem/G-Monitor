# G-Monitor — Instalação a partir do GitHub

Guia rápido para instalar o G-Monitor (SaaS multi-tenant + agente Windows) a partir do repositório oficial.

**Repo:** https://github.com/Tarcisio-maissistem/G-Monitor

---

## 1. Decidir onde instalar

| Cenário | Onde | O que sobe |
|---------|------|------------|
| Dev local (Windows/Mac/Linux) | Sua máquina | Backend + Web + Postgres + Redis (Docker) |
| Servidor LAN (intranet) | VPS/servidor Linux local | Backend + Web + Postgres + Redis + Grafana (HTTP simples) |
| Produção pública | VPS Linux + domínio | Tudo acima + Nginx + Let's Encrypt + Stripe |

Cada cenário usa um `docker-compose` diferente já versionado no repo.

---

## 2. Pré-requisitos

### Em qualquer cenário
- **Git**
- **Docker** + **Docker Compose v2**
- Porta 6060 e 8080 livres (LAN) ou 80/443 livres (produção)

### Servidor Linux (LAN ou produção)
- Ubuntu 22.04+ / Debian 12+
- 4 vCPU / 8 GB RAM / 80 GB SSD mínimo
- Acesso sudo
- Em produção: domínio com 3 subdomínios (`app.`, `api.`, `ws.`) apontando para o IP

### Dev local Windows
- Docker Desktop
- Node.js 20.19+ (`nvm install 20.19.0`)
- pnpm 9.12+ (`corepack enable && corepack prepare pnpm@9.12.0 --activate`)

---

## 3. Cenário A — Dev local

```bash
git clone -b bootstrap https://github.com/Tarcisio-maissistem/G-Monitor.git
cd G-Monitor

# Instalar dependências
pnpm install

# Subir Postgres + Redis + Grafana + Loki + Prometheus
pnpm docker:up

# Configurar env
cp .env.example .env
# Editar .env — gerar secrets:
#   openssl rand -base64 48 > para JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, AGENT_TOKEN_SECRET

# Aplicar schema no banco
pnpm db:migrate
pnpm db:generate

# Rodar backend + web em paralelo
pnpm dev
```

**URLs:**
- Frontend: http://localhost:5173
- API: http://localhost:6060/api/health
- WS agente: ws://localhost:6060/ws/agent
- Grafana: http://localhost:3030 (admin/admin)
- Prisma Studio: `pnpm db:studio` → http://localhost:5555

---

## 4. Cenário B — Servidor LAN (intranet)

Servidor Linux acessível em rede interna, sem TLS público.

### 4.1 SSH no servidor

```bash
ssh seu-usuario@<ip-servidor>
```

### 4.2 Clone + deploy automatizado

```bash
git clone -b bootstrap https://github.com/Tarcisio-maissistem/G-Monitor.git ~/G-Monitor
cd ~/G-Monitor
chmod +x scripts/deploy-local.sh
bash scripts/deploy-local.sh
```

**Importante:** primeira execução instala Docker e pede logout. Após relogar:

```bash
cd ~/G-Monitor
bash scripts/deploy-local.sh
```

### 4.3 Validar

```bash
curl http://localhost:6060/api/health
docker compose -f ~/G-Monitor/docker/docker-compose.local.yml ps
cat ~/G-Monitor/docker/.env.local | grep GRAFANA
```

**URLs (substitua `<ip>` pelo IP do servidor):**
- Frontend: `http://<ip>:8080`
- API: `http://<ip>:6060/api/health`
- Grafana: `http://<ip>:3030` (senha em `.env.local`)

---

## 5. Cenário C — Produção (VPS + domínio)

### 5.1 Provisionar VPS

- Hetzner CCX BR, Hostinger VPS BR ou DigitalOcean São Paulo
- Ubuntu 22.04 LTS, 4 vCPU / 8 GB RAM / 80 GB SSD

### 5.2 DNS

Aponte os 3 subdomínios para o IP do VPS (A records):

```
app.seudominio.com.br  A  <ip-vps>
api.seudominio.com.br  A  <ip-vps>
ws.seudominio.com.br   A  <ip-vps>
```

### 5.3 SSH + preparo

```bash
ssh root@<ip-vps>
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin git ufw
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && echo y | ufw enable

# Usuário não-root
adduser gmonitor
usermod -aG docker gmonitor
su - gmonitor
```

### 5.4 Clone + secrets

```bash
git clone -b bootstrap https://github.com/Tarcisio-maissistem/G-Monitor.git ~/G-Monitor
cd ~/G-Monitor/docker
cp .env.prod.example .env.prod

# Editar .env.prod e gerar secrets
nano .env.prod
# Para cada JWT_*_SECRET / AGENT_TOKEN_SECRET / POSTGRES_PASSWORD / REDIS_PASSWORD:
#   openssl rand -base64 48
```

Ajustar no `.env.prod`:
- `COOKIE_DOMAIN=app.seudominio.com.br`
- `CORS_ORIGIN=https://app.seudominio.com.br`
- Substituir `gmonitor.com.br` por seu domínio em `nginx.conf`

### 5.5 Certificados TLS

```bash
cd ~/G-Monitor/docker
mkdir -p certbot/conf certbot/www

# Sobe nginx temporário
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d nginx

# Emite certificados (uma vez por subdomínio)
for d in app api ws; do
  docker compose -f docker-compose.prod.yml run --rm certbot certonly \
    --webroot --webroot-path=/var/www/certbot \
    --email seu@email.com --agree-tos --no-eff-email \
    -d $d.seudominio.com.br
done

docker compose -f docker-compose.prod.yml restart nginx
```

### 5.6 Subir todos os serviços

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml exec backend pnpm prisma migrate deploy
```

### 5.7 Configurar Stripe (opcional)

1. Criar conta em Stripe Dashboard
2. Criar produtos `Starter` e `Business` com preços recorrentes
3. Copiar IDs de preço para `.env.prod` (`STRIPE_PRICE_*`)
4. Em Developers → Webhooks: adicionar `https://api.seudominio.com.br/api/stripe/webhook`
5. Eventos: `checkout.session.completed`, `customer.subscription.*`
6. Copiar webhook secret para `.env.prod` (`STRIPE_WEBHOOK_SECRET`)
7. `docker compose -f docker-compose.prod.yml --env-file .env.prod restart backend`

---

## 6. Primeiro uso

1. Abrir frontend (`http://<ip>:8080` ou `https://app.seudominio.com.br`)
2. **Signup:** cria tenant + owner com email/senha/CNPJ
3. **Login**
4. **Onboarding 2FA:** owner obrigatoriamente ativa TOTP (Google Authenticator, Authy, 1Password)
5. **Lojas → Nova Loja:** cadastra primeira loja com nome + identificador interno
6. **Gerar Agente:** copia token (aparece UMA VEZ — `agt_xxx_xxx_xxx`)
7. Instala agente Windows na máquina onde roda o Firebird

---

## 7. Instalação do agente Windows na loja

### 7.1 Pré-requisitos na máquina da loja
- Windows 10/11 Pro ou Server 2019+
- Firebird 2.5 / 3.0 / 4.0 / 5.0 já instalado e funcional
- Acesso administrador

### 7.2 Build do agente (uma vez, em qualquer máquina dev)

```bash
cd G-Monitor/apps/agent
pnpm install
pnpm build
pnpm package
# Gera: apps/agent/release/gmonitor-agent.exe
```

### 7.3 Copiar para a loja

Pelo melhor caminho (escolha um):
- USB
- Compartilhamento de rede
- Download do painel G-Monitor (release server — futuro)

Estrutura final na loja:

```
C:\Program Files\GMonitor\Agent\
  gmonitor-agent.exe
  install.ps1
  nssm.exe  (baixe de https://nssm.cc/release/nssm-2.24.zip)
```

### 7.4 Configurar e iniciar (PowerShell Admin)

```powershell
cd "C:\Program Files\GMonitor\Agent"

# Configura
.\install.ps1 `
  -Token "agt_xxx_xxx_xxx" `
  -SaasUrl "http://192.168.100.200:6060" `
  -WsUrl "ws://192.168.100.200:6060/ws/agent" `
  -FdbPath "C:\GDOOR Sistemas\GDOOR PRO\DATAGES.FDB" `
  -FbPassword "masterkey"

# Cria servico
.\nssm.exe install GMonitorAgent "C:\Program Files\GMonitor\Agent\gmonitor-agent.exe"
.\nssm.exe set GMonitorAgent AppStdout "C:\ProgramData\GMonitor\logs\stdout.log"
.\nssm.exe set GMonitorAgent AppStderr "C:\ProgramData\GMonitor\logs\stderr.log"
.\nssm.exe start GMonitorAgent
```

### 7.5 Validar

- Painel G-Monitor → Lojas → status `online` em ~30s
- Primeiro sync (base completa) pode levar de 1 a 30 min

---

## 8. Operação dia-a-dia

### Atualizar o sistema

```bash
cd ~/G-Monitor
git pull origin bootstrap
docker compose -f docker/docker-compose.local.yml --env-file docker/.env.local build backend web
docker compose -f docker/docker-compose.local.yml --env-file docker/.env.local up -d
```

### Logs

```bash
docker compose -f ~/G-Monitor/docker/docker-compose.local.yml logs -f backend
docker compose -f ~/G-Monitor/docker/docker-compose.local.yml logs -f postgres
```

### Backup do Postgres (recomendado: agendar via cron)

```bash
docker exec gmonitor-postgres pg_dump -U gmonitor gmonitor | gzip > ~/backups/gmonitor-$(date +%Y%m%d).sql.gz
```

### Reset total (apaga banco)

```bash
docker compose -f ~/G-Monitor/docker/docker-compose.local.yml down -v
```

---

## 9. Troubleshooting

| Problema | Solução |
|----------|---------|
| Agente Windows não conecta | `telnet <ip-servidor> 6060` na máquina da loja; checar firewall |
| Frontend mostra erro CORS | Conferir `CORS_ORIGIN` no `.env.local` / `.env.prod` |
| Login retorna `2fa_required` | Owner com 2FA — passar `totp` no body |
| Stripe webhook retorna 400 | `STRIPE_WEBHOOK_SECRET` errado no env |
| Postgres recusa conexão | `docker compose logs postgres` — checar healthcheck |
| Build do agente falha | Conferir Node 20.19+ e `pnpm install` antes |

---

## 10. Próximos passos depois de instalar

- Criar dashboards Grafana customizados
- Configurar backup offsite (B2/S3) via cron
- Configurar UptimeRobot apontando para `/api/health`
- Habilitar HTTPS interno mesmo em LAN (Caddy ou Nginx + cert auto-assinado)
- Pentest antes de expor publicamente
- Migrar primeiros clientes do `gdoor-relatorio` legado

---

## Links

- Repositório: https://github.com/Tarcisio-maissistem/G-Monitor
- Specs OpenSpec: `openspec/changes/create-saas-platform/`
- Setup detalhado: `SETUP.md`
- Documentação para agentes IA: `AGENTS.md`
