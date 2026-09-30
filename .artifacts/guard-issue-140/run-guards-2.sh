#!/usr/bin/env bash
# Guard reversion proofs for the issue #140 repair slice.
#
# For each test, a full throwaway copy of the repo's implementation files is
# made, the module under test is removed for the guard run (which must go red),
# then restored for the shipped run (which must go green). The working tree is
# never modified.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
work="$here/guard2"
rm -rf "$work"
mkdir -p "$work/ops/factory" "$work/scripts" "$work/ops/factory/app/src/mastra"

# Everything the factory tests read.
cp "$root"/ops/factory/*.mjs "$root"/ops/factory/*.sql "$root"/ops/factory/*.service "$root"/ops/factory/*.timer "$work/ops/factory/"
cp "$root/ops/factory/app/src/mastra/index.ts" "$work/ops/factory/app/src/mastra/index.ts"
cp "$root/ops/factory/app/src/mastra/observability-store.ts" "$work/ops/factory/app/src/mastra/observability-store.ts"
cp "$root/ops/factory/app/src/mastra/observability-retention.ts" "$work/ops/factory/app/src/mastra/observability-retention.ts"
cp "$root/scripts/agent-docs.test.mjs" "$work/scripts/"
cp -r "$root/docs" "$work/docs"

guard() { # testfile modulefile
  local testfile=$1 module=$2
  rm -f "$work/ops/factory/$module"
  ( cd "$work" && node --test "ops/factory/$testfile" 2>&1 | grep -E '^(not ok|# pass|# fail)' | head -4 )
}

shipped() { # testfile modulefile
  local testfile=$1 module=$2
  cp "$root/ops/factory/$module" "$work/ops/factory/"
  ( cd "$work" && node --test "ops/factory/$testfile" 2>&1 | grep -E '^(# pass|# fail)' | head -3 )
}

for spec in \
  "mastra-traces.test.mjs mastra-traces.mjs" \
  "monday-note-adapters.test.mjs monday-note-adapters.mjs" \
  "factory-cards.test.mjs factory-cards.mjs" \
  "monday-note-run.test.mjs monday-note-run.mjs" \
  "trace-retention.test.mjs trace-retention.mjs" \
  "trace-prune-request.test.mjs trace-prune-request.mjs" \
  "monday-note.test.mjs monday-note.mjs" ; do
  set -- $spec
  echo "== $2: guard (module removed) =="
  guard "$1" "$2"
  echo "== $2: shipped (green) =="
  shipped "$1" "$2"
done
