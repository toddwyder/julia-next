#!/usr/bin/env bash
set -euo pipefail
app_dir="$(realpath "$1")"
patch_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
source_dir="$patch_dir/app"
files=(
  package.json package-lock.json tsconfig.json src/mastra/index.ts src/mastra/local-sandbox.ts
  # Issue #140: the app-side bounded observability store and its scheduled
  # retention workflow/route. index.ts imports all three, so a clean install
  # must copy them or `npm run check` and `npm run build` cannot resolve them.
  src/mastra/observability-store.ts
  src/mastra/observability-retention.ts
  src/mastra/observability-retention-route.ts
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
python3 "$patch_dir/apply-install-patches.py" "$app_dir"
node "$patch_dir/workos-cookie-identity.check.mjs" "$app_dir"
npm run check
npm run build
# Mastra copies external packages into its deployable output.
python3 "$patch_dir/apply-install-patches.py" "$app_dir"
node "$patch_dir/workos-cookie-identity.check.mjs" "$app_dir/.mastra/output"
install -D -m 0644 "$patch_dir/wait-alerts.py" "$app_dir/ops/factory/wait-alerts.py"
install -D -m 0644 "$patch_dir/wait-alerts.sql" "$app_dir/ops/factory/wait-alerts.sql"
# Issue #140: the Monday note and the trace-retention check, plus the card
# reader they share. install-monday-note.sh installs the systemd units.
install -D -m 0644 "$patch_dir/monday-note.mjs" "$app_dir/ops/factory/monday-note.mjs"
install -D -m 0644 "$patch_dir/monday-note-run.mjs" "$app_dir/ops/factory/monday-note-run.mjs"
install -D -m 0644 "$patch_dir/monday-note-adapters.mjs" "$app_dir/ops/factory/monday-note-adapters.mjs"
install -D -m 0644 "$patch_dir/mastra-traces.mjs" "$app_dir/ops/factory/mastra-traces.mjs"
install -D -m 0644 "$patch_dir/trace-retention.mjs" "$app_dir/ops/factory/trace-retention.mjs"
install -D -m 0644 "$patch_dir/trace-prune-request.mjs" "$app_dir/ops/factory/trace-prune-request.mjs"
install -D -m 0644 "$patch_dir/factory-cards.mjs" "$app_dir/ops/factory/factory-cards.mjs"
install -D -m 0644 "$patch_dir/factory-cards.sql" "$app_dir/ops/factory/factory-cards.sql"
install -D -m 0644 "$patch_dir/run-psql.mjs" "$app_dir/ops/factory/run-psql.mjs"
printf 'Factory install, WorkOS regression, typecheck and build passed in %s\n' "$app_dir"
