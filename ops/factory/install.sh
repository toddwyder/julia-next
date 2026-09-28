#!/usr/bin/env bash
set -euo pipefail
app_dir="$(realpath "$1")"
patch_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$app_dir"
npm ci
python3 "$patch_dir/apply-install-patches.py" "$app_dir"
node "$patch_dir/workos-cookie-identity.check.mjs" "$app_dir"
npm run check
npm run build
# Mastra copies external packages into its deployable output.
python3 "$patch_dir/apply-install-patches.py" "$app_dir"
node "$patch_dir/workos-cookie-identity.check.mjs" "$app_dir/.mastra/output"
