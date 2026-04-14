#!/bin/bash
set -e

export NVM_DIR=/home/tracerqi/.nvm
source /home/tracerqi/.nvm/nvm.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PERFETTO="$SCRIPT_DIR/.."
BT=$PERFETTO/buildtools/linux64

# 1. Create Node.js symlink structure: buildtools/linux64/nodejs/bin/node
echo "=== Setting up Node.js symlink ==="
mkdir -p $BT/nodejs/bin
NVM_NODE=$(which node)
echo "nvm node path: $NVM_NODE"
ln -sf $NVM_NODE $BT/nodejs/bin/node
# Also link npm
NVM_NPM=$(which npm)
ln -sf $NVM_NPM $BT/nodejs/bin/npm
# Link npx too
NVM_NPX=$(which npx)
ln -sf $NVM_NPX $BT/nodejs/bin/npx
echo "Node.js symlink created:"
ls -la $BT/nodejs/bin/
$BT/nodejs/bin/node --version

# 2. Download GN
echo ""
echo "=== Downloading GN ==="
if [ ! -f $BT/gn ]; then
  curl -Lo /tmp/gn.zip "https://chrome-infra-packages.appspot.com/dl/gn/gn/linux-amd64/+/latest" 2>&1
  if [ $? -eq 0 ] && [ -f /tmp/gn.zip ]; then
    cd $BT
    unzip -o /tmp/gn.zip gn 2>&1
    chmod +x $BT/gn
    echo "GN installed:"
    $BT/gn --version
  else
    echo "GN download failed"
  fi
else
  echo "GN already exists"
  $BT/gn --version
fi

# 3. Download Ninja
echo ""
echo "=== Downloading Ninja ==="
if [ ! -f $BT/ninja ]; then
  curl -Lo /tmp/ninja.zip "https://github.com/nicolo-ribaudo/civetta/releases/download/2024-10-11/ninja-linux.zip" 2>&1
  if [ $? -eq 0 ] && [ -f /tmp/ninja.zip ]; then
    cd $BT
    unzip -o /tmp/ninja.zip ninja 2>&1
    chmod +x $BT/ninja
    echo "Ninja installed:"
    $BT/ninja --version
  else
    echo "Ninja download failed"
  fi
else
  echo "Ninja already exists"
  $BT/ninja --version
fi

echo ""
echo "=== Summary ==="
echo "Node: $($BT/nodejs/bin/node --version 2>&1)"
echo "GN: $($BT/gn --version 2>&1 || echo 'NOT INSTALLED')"
echo "Ninja: $($BT/ninja --version 2>&1 || echo 'NOT INSTALLED')"
