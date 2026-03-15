#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/ubuntu/wedding-gallery}"
APP_USER="${APP_USER:-ubuntu}"
SERVER_NAME="${SERVER_NAME:-_}"
PUBLIC_IP="${PUBLIC_IP:-}"
INSTALL_SYSTEM_PACKAGES="${INSTALL_SYSTEM_PACKAGES:-1}"
RUN_INDEXING="${RUN_INDEXING:-0}"
NODE_MAJOR="${NODE_MAJOR:-20}"
FORCE_FRONTEND_BUILD="${FORCE_FRONTEND_BUILD:-1}"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This script must run on the OCI Linux VM."
  exit 1
fi

if [[ ! -d "${PROJECT_DIR}" ]]; then
  echo "Project directory not found: ${PROJECT_DIR}"
  exit 1
fi

if [[ ! -f "${PROJECT_DIR}/.env" ]]; then
  echo "Missing ${PROJECT_DIR}/.env"
  exit 1
fi

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required."
  exit 1
fi

set -a
source "${PROJECT_DIR}/.env"
set +a

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    current_major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
    if [[ "${current_major}" -ge 18 ]]; then
      return
    fi
  fi

  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
}

if [[ "${INSTALL_SYSTEM_PACKAGES}" == "1" ]]; then
  sudo apt-get update
  sudo apt-get install -y \
    python3-venv \
    python3-pip \
    nginx \
    curl \
    git \
    rsync \
    build-essential \
    libgl1 \
    libglib2.0-0
fi

ensure_node

if [[ ! -d "${PROJECT_DIR}/.venv" ]]; then
  python3 -m venv "${PROJECT_DIR}/.venv"
fi

source "${PROJECT_DIR}/.venv/bin/activate"
python -m pip install --upgrade pip wheel
python -m pip install -r "${PROJECT_DIR}/backend/requirements.txt"

pushd "${PROJECT_DIR}/frontend" >/dev/null
npm ci

# Empty API base compiles frontend to use same-origin /api behind Nginx.
if [[ "${FORCE_FRONTEND_BUILD}" == "1" ]]; then
  NEXT_PUBLIC_API_URL="" npm run build
fi
popd >/dev/null

if [[ "${RUN_INDEXING}" == "1" ]]; then
  pushd "${PROJECT_DIR}" >/dev/null
  python index_faces.py --index-only
  popd >/dev/null
fi

sudo tee /etc/systemd/system/wedding-backend.service >/dev/null <<EOF
[Unit]
Description=Wedding Gallery Backend
After=network.target

[Service]
User=${APP_USER}
WorkingDirectory=${PROJECT_DIR}/backend
EnvironmentFile=${PROJECT_DIR}/.env
ExecStart=${PROJECT_DIR}/.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port ${BACKEND_PORT}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/wedding-frontend.service >/dev/null <<EOF
[Unit]
Description=Wedding Gallery Frontend
After=network.target

[Service]
User=${APP_USER}
WorkingDirectory=${PROJECT_DIR}/frontend
Environment=PORT=${FRONTEND_PORT}
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/nginx/sites-available/wedding-gallery >/dev/null <<EOF
server {
    listen 80;
    server_name ${SERVER_NAME};

    client_max_body_size 25M;

    location /api/ {
        proxy_pass http://127.0.0.1:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:${FRONTEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sfn /etc/nginx/sites-available/wedding-gallery /etc/nginx/sites-enabled/wedding-gallery
sudo nginx -t

sudo systemctl daemon-reload
sudo systemctl enable --now wedding-backend.service wedding-frontend.service nginx
sudo systemctl restart wedding-backend.service wedding-frontend.service nginx

echo ""
echo "Deployment complete."
if [[ -n "${PUBLIC_IP}" ]]; then
  echo "Fixed URL: http://${PUBLIC_IP}"
else
  echo "Fixed URL: http://<your-reserved-public-ip>"
fi
echo "Backend status:"
sudo systemctl --no-pager --full status wedding-backend.service | sed -n '1,12p'
echo "Frontend status:"
sudo systemctl --no-pager --full status wedding-frontend.service | sed -n '1,12p'
