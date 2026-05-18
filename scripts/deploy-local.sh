#!/usr/bin/env bash
# Deploy do G-Monitor em servidor Linux local (rede interna).
# Uso: bash deploy-local.sh
#
# Pre-requisitos no servidor:
#   - Ubuntu 22.04+ / Debian 12+
#   - Acesso sudo
#   - Internet para baixar Docker e dependencias
#
# Resultado: G-Monitor rodando em:
#   - Frontend: http://<ip-servidor>:8080
#   - API:      http://<ip-servidor>:6060
#   - WS:       ws://<ip-servidor>:6060/ws/agent
#   - Grafana:  http://<ip-servidor>:3030

set -euo pipefail

PROJECT_DIR="${HOME}/G-Monitor"
COMPOSE_FILE="${PROJECT_DIR}/docker/docker-compose.local.yml"

echo "==> [1/7] Atualizando sistema"
sudo apt-get update -y
sudo apt-get install -y curl ca-certificates git ufw openssl

echo "==> [2/7] Instalando Docker"
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  echo "Docker instalado. RELOGUE para usar docker sem sudo, depois rode este script de novo."
  exit 0
fi

if ! docker compose version &> /dev/null; then
  sudo apt-get install -y docker-compose-plugin
fi

echo "==> [3/7] Liberando portas no firewall local"
sudo ufw allow 22/tcp || true
sudo ufw allow 6060/tcp || true
sudo ufw allow 8080/tcp || true
sudo ufw allow 3030/tcp || true
echo "y" | sudo ufw enable || true

echo "==> [4/7] Gerando secrets em .env.local"
ENV_FILE="${PROJECT_DIR}/docker/.env.local"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
POSTGRES_USER=gmonitor
POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
POSTGRES_DB=gmonitor

REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)

JWT_ACCESS_SECRET=$(openssl rand -base64 48 | tr -d '/+=' | head -c 48)
JWT_REFRESH_SECRET=$(openssl rand -base64 48 | tr -d '/+=' | head -c 48)
AGENT_TOKEN_SECRET=$(openssl rand -base64 48 | tr -d '/+=' | head -c 48)

# Stripe (preenche depois se for cobrar)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_STARTER=
STRIPE_PRICE_BUSINESS=

# Email transacional (Resend) — opcional no MVP local
RESEND_API_KEY=
MAIL_FROM=noreply@gmonitor.local

# CORS aceita LAN
COOKIE_DOMAIN=192.168.100.200
CORS_ORIGIN=http://192.168.100.200:8080,http://localhost:8080

GRAFANA_ADMIN_PASSWORD=$(openssl rand -base64 16 | tr -d '/+=' | head -c 16)
EOF
  echo "Secrets gerados em $ENV_FILE"
else
  echo ".env.local ja existe — pulando"
fi

echo "==> [5/7] Subindo containers"
cd "${PROJECT_DIR}/docker"
docker compose -f docker-compose.local.yml --env-file .env.local pull
docker compose -f docker-compose.local.yml --env-file .env.local up -d --build

echo "==> [6/7] Aguardando Postgres ficar pronto"
for i in {1..30}; do
  if docker compose -f docker-compose.local.yml exec -T postgres pg_isready -U gmonitor > /dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "==> [7/7] Migrando banco"
docker compose -f docker-compose.local.yml exec -T backend pnpm prisma migrate deploy || \
  echo "Migracao pendente — rode manualmente apos build do backend"

IP=$(hostname -I | awk '{print $1}')
echo ""
echo "================================================="
echo " G-Monitor instalado em http://${IP}:8080"
echo " API:     http://${IP}:6060/api/health"
echo " Grafana: http://${IP}:3030 (admin/$(grep GRAFANA_ADMIN_PASSWORD $ENV_FILE | cut -d= -f2))"
echo "================================================="
echo ""
echo "Logs:    docker compose -f ${COMPOSE_FILE} logs -f backend"
echo "Parar:   docker compose -f ${COMPOSE_FILE} down"
echo "Reset:   docker compose -f ${COMPOSE_FILE} down -v"
