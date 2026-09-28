#!/usr/bin/env bash
set -euo pipefail
app_dir="$(realpath "$1")"
patch_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
source_dir="$patch_dir/app"
for file in package.json package-lock.json tsconfig.json src/mastra/index.ts; do
  if [[ ! -f "$source_dir/$file" ]]; then
    echo "missing Factory source: $source_dir/$file" >&2
    exit 1
  fi
done
mkdir -p "$app_dir/src/mastra"
for file in package.json package-lock.json tsconfig.json src/mastra/index.ts; do
  cp -- "$source_dir/$file" "$app_dir/$file"
done
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
printf 'Factory install, WorkOS regression, typecheck and build passed in %s\n' "$app_dir"
