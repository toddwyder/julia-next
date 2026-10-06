#!/usr/bin/env bash
set -euo pipefail
app_dir="$(realpath "$1")"
patch_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
source_dir="$patch_dir/app"
files=(
  package.json package-lock.json tsconfig.json src/mastra/index.ts src/mastra/local-sandbox.ts
  # Issue #140: the app-side bounded observability store and its scheduled
  # retention workflow. index.ts imports both, so a clean install must copy them
  # or `npm run check` and `npm run build` cannot resolve them.
  src/mastra/observability-store.ts
  src/mastra/observability-retention.ts
  # Issue #190: index.ts imports the asynchronous cross-maker workflow.
  # Keep it in the explicit install manifest even though the reviewer tree is copied below.
  src/mastra/reviewer/workflows/cross-maker-review-workflow.ts
  src/mastra/public/factory-skills/factory-plan/SKILL.md
  src/mastra/public/factory-skills/factory-review/SKILL.md
)
for file in "${files[@]}"; do
  if [[ ! -f "$source_dir/$file" ]]; then
    echo "missing Factory source: $source_dir/$file" >&2
    exit 1
  fi
done
if [[ ! -d "$source_dir/src/mastra/reviewer/workspace/skills" ]]; then
  echo "missing Mastra reviewer template and workspace skills" >&2
  exit 1
fi
for file in "${files[@]}"; do
  mkdir -p "$(dirname -- "$app_dir/$file")"
  cp -- "$source_dir/$file" "$app_dir/$file"
done
mkdir -p "$app_dir/src/mastra/reviewer"
cp -a "$source_dir/src/mastra/reviewer/." "$app_dir/src/mastra/reviewer/"
printf 'Installing Factory from %s into %s\n' "$source_dir" "$app_dir"
cd "$app_dir"
npm ci
npm run check
npm run build
install -D -m 0644 "$patch_dir/wait-alerts.py" "$app_dir/ops/factory/wait-alerts.py"
install -D -m 0644 "$patch_dir/wait-alerts.sql" "$app_dir/ops/factory/wait-alerts.sql"
# Issue #140: the Monday note, plus the read-only trace-retention diagnostic
# and the card reader the note shares. Retention itself is pruned by the app's
# own Mastra scheduler (no systemd trigger).
install -D -m 0644 "$patch_dir/monday-note.mjs" "$app_dir/ops/factory/monday-note.mjs"
install -D -m 0644 "$patch_dir/monday-note-run.mjs" "$app_dir/ops/factory/monday-note-run.mjs"
install -D -m 0644 "$patch_dir/monday-note-adapters.mjs" "$app_dir/ops/factory/monday-note-adapters.mjs"
install -D -m 0644 "$patch_dir/mastra-traces.mjs" "$app_dir/ops/factory/mastra-traces.mjs"
install -D -m 0644 "$patch_dir/trace-retention.mjs" "$app_dir/ops/factory/trace-retention.mjs"
install -D -m 0644 "$patch_dir/factory-cards.mjs" "$app_dir/ops/factory/factory-cards.mjs"
install -D -m 0644 "$patch_dir/factory-cards.sql" "$app_dir/ops/factory/factory-cards.sql"
install -D -m 0644 "$patch_dir/run-psql.mjs" "$app_dir/ops/factory/run-psql.mjs"
# Issue #211: the executable capture entry point and every local module it
# imports. Keep this manifest explicit so a clean server install cannot leave
# the command with an unresolved local import.
install -D -m 0755 "$patch_dir/issue-cost-capture.mjs" "$app_dir/ops/factory/issue-cost-capture.mjs"
install -D -m 0644 "$patch_dir/issue-cost-records.mjs" "$app_dir/ops/factory/issue-cost-records.mjs"
install -D -m 0644 "$patch_dir/mastra-session-messages.mjs" "$app_dir/ops/factory/mastra-session-messages.mjs"
# The retirement helper is dry-run-only; installation does not configure the
# Factory teardown hook or grant any deletion capability.
install -D -m 0755 "$patch_dir/sandbox-cleanup.mjs" "$app_dir/ops/factory/sandbox-cleanup.mjs"
printf 'Factory install, stock WorkOS auth, typecheck and build passed in %s\n' "$app_dir"
