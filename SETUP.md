# G-Monitor — Guia de Instalação

Este guia cobre setup local de desenvolvimento, deploy em VPS e instalação do agente Windows no cliente.

---

## 1. Pré-requisitos

### Dev local
- Node.js 20.19+ (`nvm install 20.19.0`)
- pnpm 9.12+ (`corepack enable && corepack prepare pnpm@9.12.0 --activate`)
- Docker Desktop (Windows/Mac) ou Docker + Docker Compose v2 (Linux)
- Git

### VPS (produção)
- Linux x86_64 (Ubuntu 22.04 LTS recomendado)
- Mínimo: 4 vCPU, 8 GB RAM, 80 GB SSD (NVMe)
- Provedores sugeridos BR: Hostinger VPS, Hetzner CCX BR, DigitalOcean São Paulo
- Domínio próprio com 3 subdomínios:
  - `app.gmonitor.com.br` → frontend
  - `api.gmonitor.com.br` → API HTTP
  - `ws.gmonitor.com.br` → WebSocket dos agentes
- Conta Stripe (modo teste para começar)
- Conta de email transacional (Resend ou Postmark)

### Cliente (loja)
- Windows 10/11 Pro ou Server 2019+
- Firebird 2.5, 3.0, 4.0 ou 5.0 já instalado e funcional
- Acesso administrador para instalar serviço
- Conexão de internet (banda mínima 1 Mbps simétrica)
- Porta 443 saída liberada (já é padrão em firewalls corporativos)

---

## 2. Setup local de desenvolvimento

```bash
# 1. Clonar e instalar
cd C:\Users\Maissistem\Desktop\GDOOR\G-Monitor
pnpm install

# 2. Subir infra local (Postgres, Redis, Grafana, Loki, Prometheus)
pnpm docker:up

# 3. Copiar e ajustar env
cp .env.example .env
# Edite .env e preencha JWT_*_SECRET e AGENT_TOKEN_SECRET com valores aleatorios:
# openssl rand -base64 48

# 4. Migrar banco
pnpm db:migrate
pnpm db:generate

# 5. Rodar backend + web em paralelo
pnpm dev
```

Endpoints:
- API: http://localhost:6060/api
- WS agente: ws://localhost:6060/ws/agent
- Frontend: http://localhost:5173
- Prisma Studio: `pnpm db:studio` → http://localhost:5555
- Grafana: http://localhost:3030 (admin/admin)

---

## 3. Setup do agente em modo dev

Em outra máquina ou na mesma com Firebird local:

```bash
cd apps/agent

# Cria config (manual no dev; em prod o instalador faz)
mkdir -p ~/.gmonitor   # Linux/Mac
# ou Windows: New-Item -ItemType Directory -Force "$env:PROGRAMDATA\GMonitor"

# Edite agent.json com o token de agente gerado via /api/agents
cat > ~/.gmonitor/agent.json <<EOF
{
  "saasUrl": "http://localhost:6060",
  "wsUrl": "ws://localhost:6060/ws/agent",
  "token": "agt_<seu_token_aqui>",
  "firebird": {
    "host": "127.0.0.1",
    "port": 3050,
    "database": "C:\\\\GDOOR Sistemas\\\\GDOOR PRO\\\\DATAGES.FDB",
    "user": "SYSDBA",
    "password": "masterkey"
  },
  "syncIntervalMs": 30000,
  "updateChannel": "stable"
}
EOF

pnpm dev
```

---

## 4. Deploy em VPS (produção)

### 4.1 Preparo do VPS

```bash
# SSH no VPS
ssh root@<ip-do-vps>

# Atualizar
apt update && apt upgrade -y

# Instalar Docker + Compose
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin git

# Firewall (UFW)
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# Usuario nao-root
adduser gmonitor
usermod -aG docker gmonitor
su - gmonitor
```

### 4.2 DNS

Aponte os 3 subdomínios para o IP do VPS (A records):
```
app.gmonitor.com.br  A  <ip-vps>
api.gmonitor.com.br  A  <ip-vps>
ws.gmonitor.com.br   A  <ip-vps>
```

### 4.3 Clonar e configurar

```bash
git clone <repo-url> /home/gmonitor/G-Monitor
cd /home/gmonitor/G-Monitor/docker

cp .env.prod.example .env.prod
# Editar .env.prod e gerar todos os secrets:
openssl rand -base64 48   # uma vez para cada JWT_*_SECRET e AGENT_TOKEN_SECRET
openssl rand -base64 32   # POSTGRES_PASSWORD e REDIS_PASSWORD
```

### 4.4 Certificados TLS (Let's Encrypt)

```bash
# Cria estrutura
mkdir -p certbot/conf certbot/www

# Sobe nginx temporario sem TLS para validar dominio
docker compose -f docker-compose.prod.yml up -d nginx

# Emite certificados (uma vez por subdominio)
for d in app api ws; do
  docker compose -f docker-compose.prod.yml run --rm certbot certonly \
    --webroot --webroot-path=/var/www/certbot \
    --email seu@email.com --agree-tos --no-eff-email \
    -d $d.gmonitor.com.br
done

# Reinicia nginx com TLS
docker compose -f docker-compose.prod.yml restart nginx
```

### 4.5 Subir tudo

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
docker compose -f docker-compose.prod.yml logs -f backend
```

### 4.6 Migração inicial do banco

```bash
docker compose -f docker-compose.prod.yml exec backend pnpm prisma migrate deploy
```

### 4.7 Configurar webhook Stripe

No painel Stripe → Developers → Webhooks → Add endpoint:
- URL: `https://api.gmonitor.com.br/api/stripe/webhook`
- Eventos: `checkout.session.completed`, `customer.subscription.*`
- Copiar webhook secret para `STRIPE_WEBHOOK_SECRET` em `.env.prod`
- Reiniciar backend: `docker compose -f docker-compose.prod.yml restart backend`

### 4.8 Backup automatizado

```bash
# Crontab do usuario gmonitor
crontab -e

# Backup diario as 03:00, retenção 14 dias, envio para B2/S3
0 3 * * * docker exec gmonitor-postgres pg_dump -U gmonitor gmonitor | gzip > /home/gmonitor/backups/gmonitor-$(date +\%Y\%m\%d).sql.gz && find /home/gmonitor/backups -mtime +14 -delete
```

---

## 5. Instalação do agente na loja (cliente)

### 5.1 Gerar token do agente (admin G-Monitor)

```bash
# Via painel: app.gmonitor.com.br -> Lojas -> Nova Loja -> Gerar Agente
# Resposta: token agt_<tenantId>_<uuid>_<secret>
# IMPORTANTE: copiar agora. Nao aparece de novo.
```

### 5.2 Instalação no Windows da loja

1. Baixar instalador `gmonitor-agent-setup-<versao>.exe` do painel
2. Executar como Administrador
3. Wizard solicita:
   - Token do agente (cola o gerado no passo 5.1)
   - Caminho do `.fdb` (default detectado se padrão GDOOR)
   - Senha do SYSDBA
4. Instalador cria:
   - Pasta `C:\Program Files\GMonitor\Agent\`
   - Config em `C:\ProgramData\GMonitor\agent.json` (criptografada)
   - Serviço Windows `GMonitorAgent` rodando como SYSTEM
   - Tray icon `gmonitor-tray.exe`

### 5.3 Instalação por PowerShell (alternativa script-only)

```powershell
# Como Administrador
cd "C:\Program Files\GMonitor\Agent"
.\install.ps1 `
  -Token "agt_xxx_xxx_xxx" `
  -SaasUrl "https://api.gmonitor.com.br" `
  -WsUrl "wss://ws.gmonitor.com.br/ws/agent" `
  -FdbPath "C:\GDOOR Sistemas\GDOOR PRO\DATAGES.FDB" `
  -FbPassword "masterkey"

# Iniciar servico
nssm install GMonitorAgent "C:\Program Files\GMonitor\Agent\gmonitor-agent.exe"
nssm start GMonitorAgent
```

### 5.4 Validar conexão

No painel G-Monitor → Lojas → status do agente deve aparecer como `online` em ~30s. Primeiro sync pode levar minutos em base grande.

---

## 6. Operação

### Logs

```bash
# Backend
docker compose -f docker-compose.prod.yml logs -f backend

# Postgres
docker compose -f docker-compose.prod.yml logs -f postgres

# Agente (na loja)
type "%PROGRAMDATA%\GMonitor\logs\agent.log"
```

### Métricas

- Grafana: `https://grafana.gmonitor.com.br` (admin / senha do .env.prod)
- Dashboards pré-prontos: visão geral, agentes, latência API, sync lag

### Update do backend

```bash
cd /home/gmonitor/G-Monitor
git pull
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod build backend web
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod up -d
```

### Update do agente

Push de release no canal `canary` → rollout automático em ondas. Owner pode forçar pelo painel.

---

## 7. Troubleshooting

| Sintoma | Causa provavel | Solução |
|---------|----------------|---------|
| Agente nao conecta | Firewall bloqueando 443 ou DNS errado | `telnet ws.gmonitor.com.br 443` |
| `Firebird not found` no agente | Caminho fora do padrão | Editar `agent.json` → `firebird.binPath` |
| `tenant_isolation` falha | RLS nao aplicada | `docker exec postgres psql -U gmonitor -c "\d tenants"` deve mostrar Policy |
| Stripe webhook 400 | Secret errado | Conferir `STRIPE_WEBHOOK_SECRET` no `.env.prod` |
| Login retorna 2fa_required | Owner com 2FA ativo | Enviar codigo TOTP no body do login |

---

## 8. Segurança em produção

- Trocar TODAS as senhas default antes de subir
- Habilitar 2FA nos owners imediatamente
- Configurar fail2ban para SSH
- Habilitar auto-updates de segurança do Ubuntu (`unattended-upgrades`)
- Backups offsite testados (restaurar em VPS de teste 1x por mês)
- Monitor de status em `status.gmonitor.com.br` (UptimeRobot ou similar)
- Pentest antes do lançamento publico
