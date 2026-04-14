#!/bin/bash
# 一键清理所有构建相关进程 + 锁文件
# 包括：build.js 主进程、tsc --watch 子进程、rollup --watch 子进程
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
pkill -f 'node ui/build.js' 2>/dev/null
pkill -f 'tsc --project.*--watch' 2>/dev/null
pkill -f 'rollup.*--watch' 2>/dev/null
# 等待进程退出
sleep 1
# 清理残留（如果 pkill 未成功）
pkill -9 -f 'node ui/build.js' 2>/dev/null
pkill -9 -f 'tsc --project' 2>/dev/null
pkill -9 -f 'rollup' 2>/dev/null
rm -f "$SCRIPT_DIR/out/ui/watch.lock"
# 验证清理结果
REMAINING=$(ps aux | grep -E 'build.js|tsc --project|rollup' | grep -v grep | wc -l)
if [ "$REMAINING" -gt 0 ]; then
  echo "Warning: $REMAINING build processes still running"
else
  echo "All build processes killed, lock file removed"
fi
