#!/bin/bash
cd /mnt/d/1aLq/ProFile/perfetto
export PATH=/mnt/d/1aLq/ProFile/perfetto/buildtools/linux64/nodejs/bin:/usr/bin:/bin

# Find all .sql files
SQL_FILES=$(find src/trace_processor/perfetto_sql/stdlib -name '*.sql' | sort)

# Run the script with a small subset first to test
python3 tools/gen_stdlib_docs_json.py --json-out /tmp/stdlib_docs_test.json --minify $SQL_FILES 2>&1
echo "EXIT CODE: $?"
