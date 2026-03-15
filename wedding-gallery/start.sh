#!/bin/bash
set -euo pipefail

set -a
source .env
set +a

BACKEND_PID=""
FRONTEND_PID=""
NGROK_PID=""
NGROK_STARTED_BY_SCRIPT="0"
STOP_NGROK_ON_EXIT="${STOP_NGROK_ON_EXIT:-0}"
CLOUDFLARED_PID=""
CLOUDFLARE_STARTED_BY_SCRIPT="0"
STOP_CLOUDFLARE_ON_EXIT="${STOP_CLOUDFLARE_ON_EXIT:-0}"
TUNNEL_PROVIDER="${TUNNEL_PROVIDER:-ngrok}"
LOG_DIR="logs"
BACKEND_LOG="${LOG_DIR}/backend.log"
FRONTEND_LOG="${LOG_DIR}/frontend.log"
NGROK_LOG="${LOG_DIR}/ngrok.log"
CLOUDFLARE_LOG="${LOG_DIR}/cloudflared.log"
PUBLIC_URL_FILE="${LOG_DIR}/public_url.txt"

cleanup() {
  if [ -n "${BACKEND_PID}" ]; then kill "${BACKEND_PID}" 2>/dev/null || true; fi
  if [ -n "${FRONTEND_PID}" ]; then kill "${FRONTEND_PID}" 2>/dev/null || true; fi
  if [ "${NGROK_STARTED_BY_SCRIPT}" = "1" ] && [ "${STOP_NGROK_ON_EXIT}" = "1" ] && [ -n "${NGROK_PID}" ]; then
    kill "${NGROK_PID}" 2>/dev/null || true
  fi
  if [ "${CLOUDFLARE_STARTED_BY_SCRIPT}" = "1" ] && [ "${STOP_CLOUDFLARE_ON_EXIT}" = "1" ] && [ -n "${CLOUDFLARED_PID}" ]; then
    kill "${CLOUDFLARED_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "🎊 Starting Wedding Gallery..."
mkdir -p "${LOG_DIR}"
: > "${BACKEND_LOG}"
: > "${FRONTEND_LOG}"
: > "${NGROK_LOG}"
: > "${CLOUDFLARE_LOG}"
: > "${PUBLIC_URL_FILE}"

# Create and activate local virtual environment for backend dependencies.
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate

BACKEND_HASH_FILE=".venv/.requirements.sha256"
CURRENT_BACKEND_HASH=$(shasum -a 256 backend/requirements.txt | awk '{print $1}')
SAVED_BACKEND_HASH=""
if [ -f "${BACKEND_HASH_FILE}" ]; then
  SAVED_BACKEND_HASH=$(cat "${BACKEND_HASH_FILE}")
fi

# Start backend
cd backend
if [ ! -f "../.venv/.deps_installed" ] || [ "${CURRENT_BACKEND_HASH}" != "${SAVED_BACKEND_HASH}" ]; then
  python -m pip install -r requirements.txt --quiet
  touch ../.venv/.deps_installed
  echo "${CURRENT_BACKEND_HASH}" > "../${BACKEND_HASH_FILE}"
else
  echo "ℹ️  Backend dependencies unchanged. Skipping pip install."
fi
python3 -m uvicorn main:app --host 0.0.0.0 --port "${BACKEND_PORT}" >> "../${BACKEND_LOG}" 2>&1 &
BACKEND_PID=$!
cd ..

# Build and start frontend
cd frontend
FRONTEND_HASH_FILE=".npm-deps.sha256"
CURRENT_FRONTEND_HASH=$(cat package.json package-lock.json 2>/dev/null | shasum -a 256 | awk '{print $1}')
SAVED_FRONTEND_HASH=""
if [ -f "${FRONTEND_HASH_FILE}" ]; then
  SAVED_FRONTEND_HASH=$(cat "${FRONTEND_HASH_FILE}")
fi

if [ ! -d "node_modules" ] || [ "${CURRENT_FRONTEND_HASH}" != "${SAVED_FRONTEND_HASH}" ]; then
  npm install --silent
  CURRENT_FRONTEND_HASH=$(cat package.json package-lock.json 2>/dev/null | shasum -a 256 | awk '{print $1}')
  echo "${CURRENT_FRONTEND_HASH}" > "${FRONTEND_HASH_FILE}"
else
  echo "ℹ️  Frontend dependencies unchanged. Skipping npm install."
fi
npm run build
PORT="${FRONTEND_PORT}" npm start >> "../${FRONTEND_LOG}" 2>&1 &
FRONTEND_PID=$!
cd ..

# Wait then start ngrok
sleep 8
if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
  echo "❌ Backend failed to start. See ${BACKEND_LOG}"
  tail -n 40 "${BACKEND_LOG}" || true
  exit 1
fi
if ! kill -0 "${FRONTEND_PID}" 2>/dev/null; then
  echo "❌ Frontend failed to start. See ${FRONTEND_LOG}"
  tail -n 40 "${FRONTEND_LOG}" || true
  exit 1
fi
PUBLIC_URL=""
ACTIVE_TUNNEL_LOG=""

if [ "${TUNNEL_PROVIDER}" = "ngrok" ]; then
  if ! command -v ngrok >/dev/null 2>&1; then
    echo "❌ ngrok is not installed. Install it from https://ngrok.com/download"
    exit 1
  fi

  NGROK_API_JSON=$(curl -fsS http://localhost:4040/api/tunnels 2>/dev/null || true)
  NGROK_URL=$(printf "%s" "${NGROK_API_JSON}" | python3 -c "import sys, json
try:
    data = json.load(sys.stdin)
except Exception:
    print('')
    raise SystemExit(0)
tunnels = data.get('tunnels', [])
urls = [t.get('public_url') for t in tunnels if t.get('public_url')]
https = [u for u in urls if u.startswith('https://')]
print((https or urls or [''])[0])")

  if [ -n "${NGROK_URL}" ]; then
    echo "ℹ️  Reusing existing ngrok tunnel: ${NGROK_URL}"
  else
    if [ -z "${NGROK_AUTHTOKEN:-}" ] || [ "${NGROK_AUTHTOKEN}" = "your_token_here" ]; then
      echo "❌ NGROK_AUTHTOKEN is not configured in .env"
      echo "   Set a real token from https://dashboard.ngrok.com/get-started/your-authtoken"
      exit 1
    fi

    ngrok http "${FRONTEND_PORT}" --authtoken "${NGROK_AUTHTOKEN}" >> "${NGROK_LOG}" 2>&1 &
    NGROK_PID=$!
    NGROK_STARTED_BY_SCRIPT="1"
    sleep 3
    NGROK_API_JSON=$(curl -fsS http://localhost:4040/api/tunnels 2>/dev/null || true)
    NGROK_URL=$(printf "%s" "${NGROK_API_JSON}" | python3 -c "import sys, json
try:
    data = json.load(sys.stdin)
except Exception:
    print('')
    raise SystemExit(0)
tunnels = data.get('tunnels', [])
urls = [t.get('public_url') for t in tunnels if t.get('public_url')]
https = [u for u in urls if u.startswith('https://')]
print((https or urls or [''])[0])")
  fi

  if [ -z "${NGROK_API_JSON}" ]; then
    echo "❌ Could not read ngrok tunnel API at http://localhost:4040/api/tunnels"
    echo "   Check ${NGROK_LOG} for details:"
    tail -n 60 "${NGROK_LOG}" || true
    exit 1
  fi

  if [ -z "${NGROK_URL}" ]; then
    echo "❌ ngrok started but no public URL was found."
    echo "   Check ${NGROK_LOG} for details:"
    tail -n 60 "${NGROK_LOG}" || true
    exit 1
  fi

  PUBLIC_URL="${NGROK_URL}"
  ACTIVE_TUNNEL_LOG="${NGROK_LOG}"

elif [ "${TUNNEL_PROVIDER}" = "cloudflare" ]; then
  if ! command -v cloudflared >/dev/null 2>&1; then
    echo "❌ cloudflared is not installed. Install with: brew install cloudflared"
    exit 1
  fi

  # Quick Tunnel only (free, no domain required). URL rotates when restarted.
  nohup cloudflared tunnel --no-autoupdate --url "http://localhost:${FRONTEND_PORT}" >> "${CLOUDFLARE_LOG}" 2>&1 &
  CLOUDFLARED_PID=$!
  CLOUDFLARE_STARTED_BY_SCRIPT="1"

  for _ in $(seq 1 25); do
    PUBLIC_URL=$(grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' "${CLOUDFLARE_LOG}" | tail -n 1 || true)
    if [ -n "${PUBLIC_URL}" ]; then
      break
    fi
    if ! kill -0 "${CLOUDFLARED_PID}" 2>/dev/null; then
      break
    fi
    sleep 1
  done

  if [ -z "${PUBLIC_URL}" ]; then
    echo "❌ cloudflared started but no public URL was found."
    echo "   Check ${CLOUDFLARE_LOG} for details:"
    tail -n 80 "${CLOUDFLARE_LOG}" || true
    exit 1
  fi

  ACTIVE_TUNNEL_LOG="${CLOUDFLARE_LOG}"
else
  echo "❌ Invalid TUNNEL_PROVIDER='${TUNNEL_PROVIDER}'. Use 'ngrok' or 'cloudflare'."
  exit 1
fi

echo ""
echo "✅ Wedding Gallery is LIVE!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔗 Share this link with family: ${PUBLIC_URL}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "${PUBLIC_URL}" > "${PUBLIC_URL_FILE}"
echo "🪵 Backend log: ${BACKEND_LOG}"
echo "🪵 Frontend log: ${FRONTEND_LOG}"
echo "🪵 Tunnel log: ${ACTIVE_TUNNEL_LOG}"
echo "🪵 Public URL file: ${PUBLIC_URL_FILE}"
if [ "${TUNNEL_PROVIDER}" = "ngrok" ] && [ "${STOP_NGROK_ON_EXIT}" != "1" ]; then
  echo "ℹ️  ngrok will remain running on exit to keep the same public URL."
fi
if [ "${TUNNEL_PROVIDER}" = "cloudflare" ] && [ "${STOP_CLOUDFLARE_ON_EXIT}" != "1" ]; then
  echo "ℹ️  cloudflared will remain running on exit. Quick Tunnel URL may change when restarted."
fi
echo "Press Ctrl+C to shut down"

wait
