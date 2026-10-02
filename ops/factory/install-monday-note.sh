#!/usr/bin/env bash
# One-time root setup to install the Monday note timer.
# Re-run this root installer after updates to refresh the signing job's copies.
#
# Installing the unit is safe and sends nothing: the Monday note service runs
# only when /etc/julia-factory-monday-note/config.env exists, and this script
# writes a mode-0640 placeholder that the operator fills in.
#
# Trace retention has no systemd unit. The app's own Mastra scheduler runs the
# supported DuckDB prune daily (declared by observabilityRetentionWorkflow), in
# the process that holds the DuckDB lock.
set -euo pipefail
if [[ ${EUID} -ne 0 || $# -ne 2 ]]; then
  echo 'Usage (root): install-monday-note.sh APP_DIR PROJECT_ID' >&2
  exit 2
fi

app_dir=$(realpath -- "$1")
project_id=$2
patch_dir=$(cd -- "$(dirname -- "$0")" && pwd)
[[ $project_id =~ ^[A-Za-z0-9_-]+$ ]] || { echo 'Invalid Factory project ID' >&2; exit 2; }
test -f "$app_dir/ops/factory/monday-note-run.mjs"
test -f "$app_dir/ops/factory/factory-cards.sql"

config_dir=/etc/julia-factory-monday-note
install -d -m 0750 -o root -g orchestrator-svc "$config_dir"
if [[ ! -e $config_dir/config.env ]]; then
  cat > "$config_dir/config.env" <<EOF
# Fill these in as root, then start julia-factory-monday-note.timer.
# Never put these values in an issue, a log, or the repository.
MONDAY_NOTE_PROJECT_ID=$project_id
MONDAY_NOTE_DATABASE=julia_factory_trial
MONDAY_NOTE_FACTORY_URL=http://127.0.0.1:4111
MONDAY_NOTE_TRACE_TOKEN=
MONDAY_NOTE_GITHUB_OWNER=toddwyder
MONDAY_NOTE_GITHUB_REPO=julia-next
MONDAY_NOTE_USE_PUBLISHER_APP=1
EOF
  chown root:orchestrator-svc "$config_dir/config.env"
  chmod 0640 "$config_dir/config.env"
fi

# Preserve a provisioned trace token while adding newly required defaults.
python3 - "$config_dir/config.env" "$project_id" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
retired = {'MONDAY_NOTE_GITHUB_TOKEN', 'MONDAY_NOTE_DISCORD_WEBHOOK'}
text = '\n'.join(line for line in text.splitlines() if line.split('=', 1)[0] not in retired) + '\n'
keys = {line.split('=', 1)[0] for line in text.splitlines() if '=' in line and not line.startswith('#')}
defaults = {
    'MONDAY_NOTE_PROJECT_ID': sys.argv[2],
    'MONDAY_NOTE_DATABASE': 'julia_factory_trial',
    'MONDAY_NOTE_FACTORY_URL': 'http://127.0.0.1:4111',
    'MONDAY_NOTE_TRACE_TOKEN': '',
    'MONDAY_NOTE_GITHUB_OWNER': 'toddwyder',
    'MONDAY_NOTE_GITHUB_REPO': 'julia-next',
    'MONDAY_NOTE_USE_PUBLISHER_APP': '1',
}
path.write_text(text.rstrip() + '\n' + ''.join(f'{key}={value}\n' for key, value in defaults.items() if key not in keys))
PY

# The publisher keeps its existing App credential. Expose only parsed phase
# fields from messages; the role cannot query prompt or tool-call bodies.
sudo -u postgres psql -v ON_ERROR_STOP=1 -d julia_factory_trial <<'SQL'
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orchestrator-svc') THEN
    CREATE ROLE "orchestrator-svc" LOGIN NOINHERIT;
  END IF;
END $$;
GRANT CONNECT ON DATABASE julia_factory_trial TO "orchestrator-svc";
GRANT USAGE ON SCHEMA public TO "orchestrator-svc";
CREATE OR REPLACE VIEW julia_monday_phase_snapshots WITH (security_barrier = true) AS
  SELECT m.thread_id, m."createdAt" AS created_at,
    (regexp_match(m.content, 'Factory [a-zA-Z_-]+ phase: ([a-zA-Z]+)'))[1] AS phase,
    (regexp_match(m.content, 'Runtime: model=[a-zA-Z0-9/._-]+, reasoning-setting=([a-zA-Z0-9_-]+)'))[1] AS effort,
    (regexp_match(m.content, 'Runtime: model=([a-zA-Z0-9/._-]+), reasoning-setting='))[1] AS model
  FROM mastra_messages m
  WHERE m.role = 'signal' AND m.type = 'factory-phase'
    AND m.content LIKE '%Factory %phase:%'
    AND m.content LIKE '%Runtime: model=%reasoning-setting=%';
REVOKE SELECT ON mastra_messages FROM "orchestrator-svc";
GRANT SELECT ON work_items, factory_run_bindings TO "orchestrator-svc";
GRANT SELECT ON julia_monday_phase_snapshots TO "orchestrator-svc";
DO $$ BEGIN
  IF has_table_privilege('orchestrator-svc', 'mastra_messages', 'SELECT') THEN
    RAISE EXCEPTION 'Monday note publisher still has raw message SELECT';
  END IF;
END $$;
ALTER ROLE "orchestrator-svc" IN DATABASE julia_factory_trial SET default_transaction_read_only = on;
COMMIT;
SQL

# Root-owned copies: the signing process must never execute builder-writable
# modules. Preserve repo-relative imports of the existing publisher helper.
note_dir=/opt/julia-factory-monday-note
for file in monday-note.mjs monday-note-run.mjs monday-note-adapters.mjs mastra-traces.mjs price-table.mjs factory-cards.mjs factory-cards.sql run-psql.mjs; do
  install -D -m 0644 -o root -g root "$patch_dir/$file" "$note_dir/ops/factory/$file"
done
install -D -m 0644 -o root -g root "$patch_dir/../../scripts/publish-via-github-app.mjs" "$note_dir/scripts/publish-via-github-app.mjs"
chown root:orchestrator-svc "$config_dir/config.env"
chmod 0640 "$config_dir/config.env"

install -m 0644 "$patch_dir/julia-factory-monday-note.service" /etc/systemd/system/
install -m 0644 "$patch_dir/julia-factory-monday-note.timer" /etc/systemd/system/

systemctl daemon-reload
# The Monday note timer is enabled but stays inert until config.env has the
# trace-reader token filled in.
systemctl enable julia-factory-monday-note.timer
echo "Monday note timer installed. Set the trace-reader token in $config_dir/config.env, then: systemctl start julia-factory-monday-note.timer"
