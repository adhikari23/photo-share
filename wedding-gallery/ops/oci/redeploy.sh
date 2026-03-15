#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/ubuntu/wedding-gallery}"
FORCE_FRONTEND_BUILD="${FORCE_FRONTEND_BUILD:-1}"
RUN_INDEXING="${RUN_INDEXING:-0}"

if [[ ! -d "${PROJECT_DIR}" ]]; then
  echo "Project directory not found: ${PROJECT_DIR}"
  exit 1
fi

if [[ ! -f "${PROJECT_DIR}/.env" ]]; then
  echo "Missing ${PROJECT_DIR}/.env"
  exit 1
fi

set -a
source "${PROJECT_DIR}/.env"
set +a

source "${PROJECT_DIR}/.venv/bin/activate"
python -m pip install -r "${PROJECT_DIR}/backend/requirements.txt"

pushd "${PROJECT_DIR}/frontend" >/dev/null
npm ci
if [[ "${FORCE_FRONTEND_BUILD}" == "1" ]]; then
  NEXT_PUBLIC_API_URL="" npm run build
fi
popd >/dev/null

if [[ "${RUN_INDEXING}" == "1" ]]; then
  pushd "${PROJECT_DIR}" >/dev/null
  python index_faces.py --index-only
  popd >/dev/null
fi

sudo systemctl restart wedding-backend.service wedding-frontend.service
sudo systemctl --no-pager --full status wedding-backend.service | sed -n '1,12p'
sudo systemctl --no-pager --full status wedding-frontend.service | sed -n '1,12p'

