#!/usr/bin/env bash
# One-time root setup to install the Monday note timer.
# Normal ops/factory/install.sh refreshes the program copies into the app.
#
# Installing the unit is safe and sends nothing: the Monday note service runs
# only when /etc/julia-factory-monday-note/config.env exists, and this script
# writes a mode-0600 placeholder that the operator fills in.
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
install -d -m 0750 -o root -g julia-factory "$config_dir"
if [[ ! -e $config_dir/config.env ]]; then
  cat > "$config_dir/config.env" <<EOF
# Fill these in as root, then start julia-factory-monday-note.timer.
# Never put these values in an issue, a log, or the repository.
MONDAY_NOTE_PROJECT_ID=$project_id
MONDAY_NOTE_DATABASE=julia_factory_trial
MONDAY_NOTE_FACTORY_URL=https://julia-factory.tail91f394.ts.net
MONDAY_NOTE_GITHUB_OWNER=toddwyder
MONDAY_NOTE_GITHUB_REPO=julia-next
MONDAY_NOTE_GITHUB_TOKEN=
MONDAY_NOTE_DISCORD_WEBHOOK=
EOF
  chown root:julia-factory "$config_dir/config.env"
  chmod 0640 "$config_dir/config.env"
fi

install -m 0644 "$patch_dir/julia-factory-monday-note.service" /etc/systemd/system/
install -m 0644 "$patch_dir/julia-factory-monday-note.timer" /etc/systemd/system/

systemctl daemon-reload
# The Monday note timer is enabled but stays inert until config.env has the
# GitHub token filled in.
systemctl enable julia-factory-monday-note.timer
echo "Monday note timer installed. It will not post until $config_dir/config.env is filled in (token), then: systemctl start julia-factory-monday-note.timer"

