#!/bin/bash
# 如果已有 build.js 实例在运行，先杀掉（防止多实例并发导致端口冲突）
# 不直接 rm watch.lock，那样会绕过多实例检测
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCKFILE="$SCRIPT_DIR/out/ui/watch.lock"
if [ -f "$LOCKFILE" ]; then
  OLD_PID=$(cat "$LOCKFILE" 2>/dev/null | tr -d '[:space:]')
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Killing existing build.js instance (PID=$OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null
    sleep 2
    # 如果还没退出，强制杀
    if kill -0 "$OLD_PID" 2>/dev/null; then
      kill -9 "$OLD_PID" 2>/dev/null
      sleep 1
    fi
  fi
  rm -f "$LOCKFILE"
fi
# 清理可能残留的子进程（tsc --watch, rollup --watch）
pkill -f 'tsc --project.*perfetto.*--watch' 2>/dev/null
pkill -f 'rollup.*perfetto.*--watch' 2>/dev/null
sleep 1

cd "$SCRIPT_DIR"
export PATH="$SCRIPT_DIR/buildtools/linux64/nodejs/bin:$SCRIPT_DIR/third_party/gn:$SCRIPT_DIR/third_party/ninja:/usr/bin:/bin"
export EMSDK="$SCRIPT_DIR/buildtools/linux64/emsdk"
export EM_CONFIG="$SCRIPT_DIR/buildtools/linux64/emsdk/.emscripten"
export NODE_OPTIONS=--max-old-space-size=8192
node ui/build.js --no-depscheck --only-wasm-memory64 --no-override-gn-args --serve --watch 2>&1
