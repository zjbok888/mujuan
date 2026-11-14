#!/bin/sh
# 墨卷 · 启动脚本（macOS / Linux）
set -e
cd "$(dirname "$0")"
exec node scripts/serve.mjs "$@"
