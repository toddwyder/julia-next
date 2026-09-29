#!/usr/bin/env bash
# One-time root setup. Normal ops/factory/install.sh refreshes the watcher code.
set -euo pipefail
if [[ ${EUID} -ne 0 || $# -ne 4 ]]; then
  echo 'Usage (root): install-wait-alerts.sh APP_DIR PROJECT_ID USER_ID FACTORY_URL' >&2
  exit 2
fi
app_dir=$(realpath -- "$1")
project_id=$2
user_id=$3
factory_url=$4
patch_dir=$(cd -- "$(dirname -- "$0")" && pwd)
[[ $project_id =~ ^[A-Za-z0-9_-]+$ && $user_id =~ ^[A-Za-z0-9_-]+$ && $factory_url == https://* ]] || {
  echo 'Invalid project, user, or Factory URL' >&2; exit 2;
}
test -f "$app_dir/ops/factory/wait-alerts.py"
test -f "$app_dir/ops/factory/wait-alerts.sql"

# Peer authentication gives this host account only the SELECTs the watcher needs.
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d julia_factory_trial <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'julia-factory') THEN
    CREATE ROLE "julia-factory" LOGIN NOINHERIT;
  END IF;
END $$;
GRANT CONNECT ON DATABASE julia_factory_trial TO "julia-factory";
GRANT USAGE ON SCHEMA public TO "julia-factory";
GRANT SELECT ON factory_run_bindings, work_items, mastra_messages,
  factory_attention_receipts, factory_deferred_decisions,
  factory_supervisor_findings, work_item_comment_mentions,
  work_item_comments TO "julia-factory";
ALTER ROLE "julia-factory" SET default_transaction_read_only = on;
SQL

config_dir=/etc/julia-factory-wait-alerts
install -d -m 0750 -o root -g julia-factory "$config_dir"
if [[ ! -e $config_dir/config.json ]]; then
  topic="julia_factory_$(openssl rand -hex 24)"
  python3 - "$config_dir/config.json" "$project_id" "$user_id" "$factory_url" "$topic" <<'PY'
import json, sys
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps({
    'database': 'julia_factory_trial', 'project_id': sys.argv[2],
    'user_id': sys.argv[3], 'factory_url': sys.argv[4], 'topic': sys.argv[5],
}) + '\n', encoding='utf-8')
PY
  chown root:julia-factory "$config_dir/config.json"
  chmod 0640 "$config_dir/config.json"
fi
install -m 0644 "$patch_dir/julia-factory-wait-alerts.service" /etc/systemd/system/
install -m 0644 "$patch_dir/julia-factory-wait-alerts.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now julia-factory-wait-alerts.timer
echo 'Watcher installed. Delivery stays off until /etc/julia-factory-wait-alerts/subscribed exists.'
