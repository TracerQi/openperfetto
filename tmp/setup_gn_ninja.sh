#!/bin/bash
set -e

export NVM_DIR=/home/tracerqi/.nvm
source /home/tracerqi/.nvm/nvm.sh

PERFETTO=/mnt/d/1aLq/ProFile/perfetto
BT=$PERFETTO/buildtools/linux64
mkdir -p $BT

# 1. Download Ninja from official ninja-build releases
echo "=== Downloading Ninja ==="
if [ ! -f $BT/ninja ]; then
  curl -Lo /tmp/ninja-linux.zip "https://github.com/ninja-build/ninja/releases/download/v1.12.1/ninja-linux.zip" --connect-timeout 30 -f 2>&1
  if [ $? -eq 0 ]; then
    cd $BT
    unzip -o /tmp/ninja-linux.zip ninja 2>&1
    chmod +x $BT/ninja
    echo "Ninja installed: $($BT/ninja --version)"
  else
    echo "Ninja download from GitHub failed"
  fi
else
  echo "Ninja already exists: $($BT/ninja --version)"
fi

# 2. Download GN - try Chrome infra with timeout
echo ""
echo "=== Downloading GN ==="
if [ ! -f $BT/gn ]; then
  # Try Chrome infra (may be blocked)
  echo "Trying chrome-infra-packages..."
  curl -Lo /tmp/gn.zip "https://chrome-infra-packages.appspot.com/dl/gn/gn/linux-amd64/+/latest" --connect-timeout 15 -f 2>&1
  if [ $? -eq 0 ] && [ -f /tmp/gn.zip ] && [ $(stat -c%s /tmp/gn.zip 2>/dev/null || echo 0) -gt 1000 ]; then
    cd $BT
    unzip -o /tmp/gn.zip gn 2>&1
    chmod +x $BT/gn
    echo "GN installed: $($BT/gn --version)"
  else
    echo "Chrome infra failed. Trying to build GN from source..."
    echo "GN NOT INSTALLED - will need alternative approach"
  fi
else
  echo "GN already exists: $($BT/gn --version)"
fi

echo ""
echo "=== Final Status ==="
echo "Node: $($BT/nodejs/bin/node --version 2>&1 || echo 'MISSING')"
echo "GN: $($BT/gn --version 2>&1 || echo 'MISSING')"
echo "Ninja: $($BT/ninja --version 2>&1 || echo 'MISSING')"
