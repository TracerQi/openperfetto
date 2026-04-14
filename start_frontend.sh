#!/bin/bash
# 纯前端开发：跳过 WASM 编译 + watch 模式
# 适用于仅修改 TypeScript/SCSS 的场景，首次构建约 2-3 分钟（比 run_build.sh 快）
# 后续文件修改 watch 自动增量编译，仅需几秒

# 清理已有构建实例（与 run_build.sh 一致的逻辑）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
LOCKFILE=out/ui/watch.lock
if [ -f "$LOCKFILE" ]; then
  OLD_PID=$(cat "$LOCKFILE" 2>/dev/null | tr -d '[:space:]')
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Killing existing build.js instance (PID=$OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null
    sleep 2
    if kill -0 "$OLD_PID" 2>/dev/null; then
      kill -9 "$OLD_PID" 2>/dev/null
      sleep 1
    fi
  fi
  rm -f "$LOCKFILE"
fi
pkill -f 'tsc --project.*perfetto.*--watch' 2>/dev/null
pkill -f 'rollup.*perfetto.*--watch' 2>/dev/null
sleep 1

export PATH="$SCRIPT_DIR/buildtools/linux64/nodejs/bin:$SCRIPT_DIR/third_party/gn:$SCRIPT_DIR/third_party/ninja:/usr/bin:/bin"
export EMSDK="$SCRIPT_DIR/buildtools/linux64/emsdk"
export EM_CONFIG="$SCRIPT_DIR/buildtools/linux64/emsdk/.emscripten"
export NODE_OPTIONS=--max-old-space-size=8192
node ui/build.js --no-depscheck --no-wasm --only-wasm-memory64 --no-override-gn-args --serve --watch 2>&1
