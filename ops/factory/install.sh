#!/usr/bin/env bash
set -euo pipefail
app_dir="$(realpath "$1")"
patch_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
source_dir="$patch_dir/app"
repo_dir="$(realpath "$patch_dir/../..")"
app_owner="$(stat -c '%U' "$app_dir")"
app_group="$(stat -c '%G' "$app_dir")"
service_name="julia-factory-trial.service"
install_commit=""
backup_dir=""
backup_ready=false

restore_previous_app() {
  rm -rf -- "$app_dir"
  mv -- "$backup_dir" "$app_dir"
  backup_ready=false
}

restore_after_failure() {
  status=$?
  trap - EXIT
  if [[ "$backup_ready" == true ]]; then
    echo 'Factory install failed; restoring previous app' >&2
    restore_previous_app
    if ! systemctl restart "$service_name"; then
      echo 'Factory install rollback restart failed' >&2
    fi
  fi
  exit "$status"
}

verify_or_restore() {
  local reason="$1"
  echo "Factory install verification failed: $reason; restoring previous app" >&2
  restore_previous_app
  if ! systemctl restart "$service_name"; then
    echo 'Factory install rollback restart failed' >&2
  fi
  exit 1
}

trap restore_after_failure EXIT

# The operator deploys through sudo, but the Factory process runs as the owner
# of its app directory. Build as that owner so the generated .mastra output is
# replaceable by the running service on a later Mastra rebuild.
run_as_app_owner() {
  if [[ "$(id -u)" -eq 0 ]]; then
    runuser -u "$app_owner" -- "$@"
  else
    "$@"
  fi
}
files=(
  package.json package-lock.json tsconfig.json src/mastra/index.ts src/mastra/local-sandbox.ts
  # Issue #140: the app-side bounded observability store and its scheduled
  # retention workflow. index.ts imports both, so a clean install must copy them
  # or `npm run check` and `npm run build` cannot resolve them.
  src/mastra/observability-store.ts
  src/mastra/observability-retention.ts
  src/mastra/issue-cost-capture.ts
  src/mastra/model-price-refresh.ts
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
install_commit="$(git -C "$repo_dir" rev-parse HEAD)"
backup_dir="$(mktemp -d "${app_dir}.before-install.XXXXXX")"
chown --reference="$app_dir" "$backup_dir"
chmod --reference="$app_dir" "$backup_dir"
cp -a -- "$app_dir/." "$backup_dir/"
backup_ready=true
for file in "${files[@]}"; do
  mkdir -p "$(dirname -- "$app_dir/$file")"
  cp -- "$source_dir/$file" "$app_dir/$file"
done
mkdir -p "$app_dir/src/mastra/reviewer"
cp -a "$source_dir/src/mastra/reviewer/." "$app_dir/src/mastra/reviewer/"
printf 'Installing Factory from %s into %s\n' "$source_dir" "$app_dir"
cd "$app_dir"
if [[ "$(id -u)" -eq 0 ]]; then
  chown -R "$app_owner:$app_group" "$app_dir"
fi
run_as_app_owner npm ci
run_as_app_owner npm run check
run_as_app_owner npm run build
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
# The retirement helper is dry-run-only; installation does not configure the
# Factory teardown hook or grant any deletion capability.
install -D -m 0755 "$patch_dir/sandbox-cleanup.mjs" "$app_dir/ops/factory/sandbox-cleanup.mjs"
printf '%s\n' "$install_commit" > "$app_dir/BUILD_COMMIT"
if ! systemctl restart "$service_name"; then
  verify_or_restore 'service restart'
fi
if ! systemctl is-active --quiet "$service_name"; then
  verify_or_restore 'service is not active after restart'
fi
if ! service_working_dir="$(systemctl show "$service_name" --property=WorkingDirectory --value)"; then
  verify_or_restore 'service working directory could not be read'
fi
if [[ "$(realpath "$service_working_dir")" != "$app_dir" ]]; then
  verify_or_restore "service working directory is $service_working_dir, expected $app_dir"
fi
if [[ "$(< "$app_dir/BUILD_COMMIT")" != "$install_commit" ]]; then
  verify_or_restore 'BUILD_COMMIT does not match the installed commit'
fi
rm -rf -- "$backup_dir"
backup_ready=false
trap - EXIT
printf 'Factory install verified commit %s in %s; stock WorkOS auth, typecheck and build passed\n' "$install_commit" "$app_dir"
