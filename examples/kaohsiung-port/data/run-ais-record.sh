#!/usr/bin/env bash
# 高雄港 F1 真實 AIS — 一鍵全自動錄製管線
# probe(台灣 IP 健康檢查)→ 限時錄製 → 自動 export → 印出產出檔。
#
# 用法(repo 根目錄):
#   npm run port:ais:auto                 # 預設 24h、每 30s 輪詢、前景執行
#   DURATION_HOURS=12 npm run port:ais:auto
#   AIS_POLL_MS=15000 npm run port:ais:auto
#   BACKGROUND=1 npm run port:ais:auto    # 自我 detach,寫 log,印 PID
#   DURATION_HOURS=0.05 npm run port:ais:auto   # 3 分鐘快測整條管線
#
# 可調旋鈕(環境變數):
#   DURATION_HOURS  錄製時長(小時,可小數)         預設 24
#   AIS_POLL_MS     輪詢間隔(毫秒,錄製器讀取)       預設 30000
#   SKIP_PROBE=1    跳過開頭的端點健康檢查
#   SKIP_EXPORT=1   只錄製、不自動 export
#   BACKGROUND=1    用 nohup/setsid 背景執行並寫 log
#   TWPORT_POLL_MIN TWPort 並行錄製輪詢間隔(分鐘)     預設 15
#   SKIP_TWPORT=1   不並行錄 TWPort 指泊/預報名單

set -euo pipefail

DURATION_HOURS="${DURATION_HOURS:-24}"
SKIP_PROBE="${SKIP_PROBE:-0}"
SKIP_EXPORT="${SKIP_EXPORT:-0}"
BACKGROUND="${BACKGROUND:-0}"
SKIP_TWPORT="${SKIP_TWPORT:-0}"
TWPORT_POLL_MIN="${TWPORT_POLL_MIN:-15}"

# repo 根目錄(優先用 git,失敗則由腳本位置往上推三層)
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
fi
cd "$ROOT"

DATA_DIR="$ROOT/examples/kaohsiung-port/data"
TRACKS_DIR="$DATA_DIR/ais-tracks"
VITE_NODE="$ROOT/node_modules/.bin/vite-node"
REC_TS="$DATA_DIR/record-ais.ts"
PROBE_TS="$DATA_DIR/probe-ais.ts"
EXPORT_TS="$DATA_DIR/export-ais-tracks.ts"
TWPORT_TS="$DATA_DIR/record-twport.ts"

log() { printf '\033[36m[ais-auto]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[ais-auto] 錯誤:\033[0m %s\n' "$*" >&2; exit 1; }

# ── BACKGROUND:自我 detach,寫 log,印 PID 後退出 ────────────────────────────
if [ "$BACKGROUND" = "1" ]; then
  mkdir -p "$TRACKS_DIR"
  LOG="$TRACKS_DIR/run-$(date +%Y%m%d-%H%M%S).log"
  RUNNER="nohup"
  command -v setsid >/dev/null 2>&1 && RUNNER="setsid"
  BACKGROUND=0 nohup "$RUNNER" bash "$0" >"$LOG" 2>&1 < /dev/null &
  log "背景執行中 · PID=$! · log: $LOG"
  log "查看進度: tail -f \"$LOG\""
  log "提早停止: kill -TERM <PID 群組>(或關掉該 process）"
  exit 0
fi

# ── 0) 前置檢查 ──────────────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || die "找不到 node。請先安裝 Node.js 18+。"
NODE_MAJOR="$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node 版本過舊(v$(node -v))。record-ais 用了全域 fetch,需 Node 18+。"

if [ ! -x "$VITE_NODE" ]; then
  log "未發現 vite-node,執行 npm install …"
  npm install
fi
[ -x "$VITE_NODE" ] || die "npm install 後仍找不到 vite-node($VITE_NODE)。"

mkdir -p "$TRACKS_DIR"

# ── 1) Probe:台灣 IP / 端點健康檢查(非 JSON 會 throw → 在此攔截) ──────────
if [ "$SKIP_PROBE" = "1" ]; then
  log "SKIP_PROBE=1 → 跳過健康檢查"
else
  log "健康檢查端點(需台灣 IP)…"
  if ! "$VITE_NODE" "$PROBE_TS"; then
    die "probe 失敗 —— 多半是非台灣 IP 被擋(回非 JSON),或端點/網路異常。確認台灣出口 IP 後再跑;確定要硬跑可 SKIP_PROBE=1。"
  fi
  log "健康檢查通過 ✓"
fi

# ── 2) 限時錄製 ──────────────────────────────────────────────────────────────
# 錄製器是無限韌性 loop,用 timeout 在 DURATION_HOURS 後送 SIGTERM 收尾。
# 直接呼叫 vite-node(不經 npm)以確保 signal 確實到達 node。
DURATION_SECONDS="$(awk "BEGIN{printf \"%d\", $DURATION_HOURS*3600}")"
[ "$DURATION_SECONDS" -ge 1 ] || die "DURATION_HOURS 太小($DURATION_HOURS),算出 <1 秒。"
export AIS_POLL_MS="${AIS_POLL_MS:-30000}"

# 並行啟動 TWPort 累積錄製(自我限時同 DURATION),與 AIS 並跑、獨立輸出檔。
TW_PID=""
if [ "$SKIP_TWPORT" = "1" ]; then
  log "SKIP_TWPORT=1 → 不並行錄 TWPort"
else
  log "並行啟動 TWPort 錄製:每 ${TWPORT_POLL_MIN}min · 限時同 ${DURATION_HOURS}h"
  if command -v timeout >/dev/null 2>&1; then
    TWPORT_POLL_MIN="$TWPORT_POLL_MIN" timeout --signal=TERM --kill-after=20s "${DURATION_SECONDS}s" "$VITE_NODE" "$TWPORT_TS" &
    TW_PID=$!
  else
    TWPORT_POLL_MIN="$TWPORT_POLL_MIN" "$VITE_NODE" "$TWPORT_TS" &
    TW_PID=$!
    ( sleep "$DURATION_SECONDS"; kill -TERM "$TW_PID" 2>/dev/null ) &
  fi
fi

log "開始錄製:時長 ${DURATION_HOURS}h(${DURATION_SECONDS}s)· 輪詢 ${AIS_POLL_MS}ms"
log "輸出 raw → $TRACKS_DIR/raw-khh-<UTC日期>.jsonl"

set +e
if command -v timeout >/dev/null 2>&1; then
  timeout --signal=TERM --kill-after=20s "${DURATION_SECONDS}s" "$VITE_NODE" "$REC_TS"
  REC_RC=$?
else
  # 沒有 coreutils timeout(如部分 macOS):背景跑 + sleep + kill 收尾。
  "$VITE_NODE" "$REC_TS" &
  REC_PID=$!
  ( sleep "$DURATION_SECONDS"; kill -TERM "$REC_PID" 2>/dev/null ) &
  WATCH_PID=$!
  wait "$REC_PID"; REC_RC=$?
  kill "$WATCH_PID" 2>/dev/null || true
fi
set -e

# 0=正常結束(不會發生,loop 無限)· 124=timeout 到點(預期)· 143=收到 SIGTERM(預期)
case "$REC_RC" in
  0|124|143) log "錄製結束(rc=$REC_RC,屬正常收尾)" ;;
  *) log "⚠ 錄製以 rc=$REC_RC 結束 —— 仍嘗試 export 已錄到的資料" ;;
esac

# AIS 已收尾;等並行的 TWPort 也自我限時結束(原子寫入確保最後一檔完整)。
if [ -n "${TW_PID:-}" ]; then
  log "等待 TWPort 錄製收尾…"
  wait "$TW_PID" 2>/dev/null || true
  log "TWPort 錄製結束"
fi

# ── 3) 自動 export → per-MMSI tracks JSON ───────────────────────────────────
if [ "$SKIP_EXPORT" = "1" ]; then
  log "SKIP_EXPORT=1 → 不轉檔。手動轉:npm run port:ais:export"
  exit 0
fi

log "轉檔 export(取最新 raw-khh-*.jsonl)…"
"$VITE_NODE" "$EXPORT_TS"

LATEST_JSON="$(ls -t "$TRACKS_DIR"/khh-*.json 2>/dev/null | head -1 || true)"
[ -n "$LATEST_JSON" ] || die "export 後找不到 khh-*.json。檢查上方 export 輸出。"

log "完成 ✓ 產出:$LATEST_JSON"
log "大小:$(du -h "$LATEST_JSON" | cut -f1)"
log "把這個檔 copy 回開發機的 examples/kaohsiung-port/data/ais-tracks/ 即可(只 commit khh-*.json)。"
LATEST_SNAP="$(ls -t "$DATA_DIR/snapshots"/khh-*.json 2>/dev/null | head -1 || true)"
if [ -n "$LATEST_SNAP" ]; then
  log "TWPort snapshot:$LATEST_SNAP($(du -h "$LATEST_SNAP" | cut -f1))"
  log "提醒:把 ais-tracks/khh-*.json 與 snapshots/khh-*.json 兩個檔一起 copy 回開發機。"
fi
