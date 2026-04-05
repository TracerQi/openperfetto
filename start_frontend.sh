#!/bin/bash
cd /mnt/d/1aLq/ProFile/perfetto
rm -f out/ui/watch.lock
export PATH=/mnt/d/1aLq/ProFile/perfetto/buildtools/linux64/nodejs/bin:/mnt/d/1aLq/ProFile/perfetto/third_party/gn:/mnt/d/1aLq/ProFile/perfetto/third_party/ninja:/usr/bin:/bin
export EMSDK=/mnt/d/1aLq/ProFile/perfetto/buildtools/linux64/emsdk
export EM_CONFIG=/mnt/d/1aLq/ProFile/perfetto/buildtools/linux64/emsdk/.emscripten
export NODE_OPTIONS=--max-old-space-size=8192
node ui/build.js --no-depscheck --no-wasm --only-wasm-memory64 --serve 2>&1
