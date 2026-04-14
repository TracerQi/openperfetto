#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
export PATH="$SCRIPT_DIR/buildtools/linux64/nodejs/bin:/usr/bin:/bin"

# Find all .sql files
SQL_FILES=$(find src/trace_processor/perfetto_sql/stdlib -name '*.sql' | sort)

# Run the script with a small subset first to test
python3 tools/gen_stdlib_docs_json.py --json-out /tmp/stdlib_docs_test.json --minify $SQL_FILES 2>&1
echo "EXIT CODE: $?"
