#!/bin/bash
rm -f /mnt/d/1aLq/ProFile/perfetto/out/ui/watch.lock
cd /mnt/d/1aLq/ProFile/perfetto
export PATH=/mnt/d/1aLq/ProFile/perfetto/buildtools/linux64/nodejs/bin:/mnt/d/1aLq/ProFile/perfetto/third_party/gn:/mnt/d/1aLq/ProFile/perfetto/third_party/ninja:/usr/bin:/bin
export EMSDK=/mnt/d/1aLq/ProFile/perfetto/buildtools/linux64/emsdk
export EM_CONFIG=/mnt/d/1aLq/ProFile/perfetto/buildtools/linux64/emsdk/.emscripten
export NODE_OPTIONS=--max-old-space-size=8192
node ui/build.js --no-depscheck --only-wasm-memory64 --no-override-gn-args --serve --watch 2>&1
