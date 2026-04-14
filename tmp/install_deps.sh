#!/bin/bash
export NVM_DIR=/home/tracerqi/.nvm
source /home/tracerqi/.nvm/nvm.sh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."
python3 tools/install-build-deps --ui 2>&1
