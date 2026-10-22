#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "============================================="
echo "   运行 SCIP-OJ Phase 3 Smoke 打磨验证脚本   "
echo "============================================="

cd "$REPO_ROOT"
python3 "$SCRIPT_DIR/smoke_phase3.py"
