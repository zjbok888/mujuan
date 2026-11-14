#!/bin/sh
# 墨卷 · 停止脚本（macOS / Linux）
set -e
cd "$(dirname "$0")"
exec node scripts/stop-server.mjs "$@"
