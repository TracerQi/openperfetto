#!/bin/bash
pkill -f 'node ui/build.js' 2>/dev/null
pkill -f 'rollup' 2>/dev/null
pkill -f 'tsc --project' 2>/dev/null
rm -f /mnt/d/1aLq/ProFile/perfetto/out/ui/watch.lock
echo "Build processes killed"
