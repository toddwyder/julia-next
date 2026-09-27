#!/usr/bin/env bash
set -euo pipefail
app_dir="$(realpath "$1")"
patch_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$app_dir"
npm ci
python3 "$patch_dir/apply-install-patches.py" "$app_dir"
node "$patch_dir/workos-cookie-identity.test.mjs" "$app_dir"
mkdir -p src/mastra/trial
cp "$patch_dir/trial-board.mjs" "$patch_dir/trial-board.d.mts" "$patch_dir/trial-transition.test.mjs" src/mastra/trial/
python3 "$patch_dir/configure-entry.py" "$app_dir"
node src/mastra/trial/trial-transition.test.mjs
npm run check
npm run build
# Mastra copies external packages into its deployable output.
python3 "$patch_dir/apply-install-patches.py" "$app_dir"
node "$patch_dir/workos-cookie-identity.test.mjs" "$app_dir/.mastra/output"
