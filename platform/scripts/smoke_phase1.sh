#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "============================================="
echo "   运行 SCIP-OJ Phase 1 Smoke 自测脚本      "
echo "============================================="

cd "${REPO_ROOT}"
python3 "${SCRIPT_DIR}/smoke_phase1.py"
