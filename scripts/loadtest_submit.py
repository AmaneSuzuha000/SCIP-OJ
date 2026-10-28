#!/usr/bin/env python3
"""SCIP-OJ 并发压测与合约检验脚本 CLI 入口

用法:
  python3 scripts/loadtest_submit.py --concurrency 10
  python3 scripts/loadtest_submit.py --concurrency 30
  python3 scripts/loadtest_submit.py --concurrency 50
  python3 scripts/loadtest_submit.py --mode dry-run
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MJS_SCRIPT = ROOT / "scripts/loadtest_submit.mjs"


def main():
    parser = argparse.ArgumentParser(description="SCIP-OJ 并发提交压测与合约检验工具")
    parser.add_argument("-n", "--concurrency", type=int, default=10,
                        help="并发请求数 (例如 10, 30, 50)")
    parser.add_argument("--mode", choices=["local", "dry-run"], default="local",
                        help="压测模式：local (本地PGlite真实合约测试，默认) 或 dry-run (离线构造模拟)")
    parser.add_argument("--json", action="store_true", help="输出 JSON 格式原始数据")
    args = parser.parse_args()

    cmd = ["node", str(MJS_SCRIPT), "-n", str(args.concurrency), "--mode", args.mode]
    if args.json:
        cmd.append("--json")

    res = subprocess.run(cmd, cwd=str(ROOT))
    sys.exit(res.returncode)


if __name__ == "__main__":
    main()
