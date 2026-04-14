#!/bin/bash
export NVM_DIR=/home/tracerqi/.nvm
source /home/tracerqi/.nvm/nvm.sh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../server"
npm run dev 2>&1
