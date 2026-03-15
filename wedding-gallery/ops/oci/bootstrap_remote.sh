#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <ssh_target> <remote_project_dir> <reserved_public_ip>"
  echo "Example: $0 ubuntu@129.154.x.x /home/ubuntu/wedding-gallery 129.154.x.x"
  exit 1
fi

SSH_TARGET="$1"
REMOTE_DIR="$2"
RESERVED_PUBLIC_IP="$3"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

"${SCRIPT_DIR}/sync_to_vm.sh" "${SSH_TARGET}" "${REMOTE_DIR}"

ssh "${SSH_TARGET}" "
set -euo pipefail
cd '${REMOTE_DIR}'
chmod +x ops/oci/provision_vm.sh ops/oci/redeploy.sh ops/oci/sync_to_vm.sh ops/oci/bootstrap_remote.sh
PUBLIC_IP='${RESERVED_PUBLIC_IP}' RUN_INDEXING=0 ./ops/oci/provision_vm.sh
"

