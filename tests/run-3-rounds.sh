#!/usr/bin/env bash
# 跑 observer+retrospect+pulse e2e 3 轮, 任一轮挂整个 fail。
# LLM 非确定性 — 3 轮全过才能验证特性稳定。
#
# 用法: bash tests/run-3-rounds.sh
#   或: E2E_BASE=http://localhost:3000 bash tests/run-3-rounds.sh

set -e

E2E_BASE="${E2E_BASE:-https://darwin.org.cn}"
EMAIL="${EMAIL:-xuxin@deeplumen.com}"
AGENT_ID="${AGENT_ID:-8b442084-6e74-4928-ae77-e497248c30bc}"

cd "$(dirname "$0")/.."

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  observer + retrospect + pulse — 3 轮自动化测试            ║"
echo "║  target: $E2E_BASE"
echo "║  每轮 ~150s (75 tension + 45 retrospect/observe + 25 misc) ║"
echo "╚════════════════════════════════════════════════════════════╝"

START=$(date +%s)
for round in 1 2 3; do
  echo ""
  echo ">>> Starting round $round / 3"
  E2E_BASE="$E2E_BASE" EMAIL="$EMAIL" AGENT_ID="$AGENT_ID" \
    node tests/observer-retrospect-pulse-e2e.mjs "$round"
done
END=$(date +%s)
ELAPSED=$((END - START))

echo ""
echo "════════════════════════════════════════════════════════════"
echo "✅ 3 轮全部通过 (耗时 ${ELAPSED}s)"
echo "════════════════════════════════════════════════════════════"
