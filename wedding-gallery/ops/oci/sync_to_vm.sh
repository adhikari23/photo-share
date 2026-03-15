#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <ssh_target> <remote_project_dir>"
  echo "Example: $0 ubuntu@129.154.x.x /home/ubuntu/wedding-gallery"
  exit 1
fi

SSH_TARGET="$1"
REMOTE_DIR="$2"
LOCAL_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

rsync -az --delete \
  --exclude '.git/' \
  --exclude '.venv/' \
  --exclude 'frontend/node_modules/' \
  --exclude 'frontend/.next/' \
  --exclude 'logs/' \
  --exclude 'embeddings.json' \
  --exclude 'users.txt' \
  "${LOCAL_DIR}/" "${SSH_TARGET}:${REMOTE_DIR}/"

echo "Sync complete: ${SSH_TARGET}:${REMOTE_DIR}"

