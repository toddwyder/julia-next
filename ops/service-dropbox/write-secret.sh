#!/bin/sh
# write-secret.sh -- the only thing that ever writes into the protected
# secret files this drop box fills. Installed root:root, mode 0700, and
# invoked only via a narrowly scoped NOPASSWD sudoers rule that names this
# exact path (see README.md) -- dropbox-svc itself never has write access to
# the destination directory, only permission to run this one fixed script.
#
# Reads the secret value from stdin (never argv -- argv is visible to any
# other local process via /proc/<pid>/cmdline or `ps`; stdin to a
# short-lived child is not). Takes exactly one argument: which of the four
# known fields this write is for. Any other argument is refused outright --
# this script does not take an arbitrary destination path, so a compromised
# or buggy caller can never redirect a write outside the four fixed targets.
set -eu

DEST_DIR=/etc/orca-runner/dropbox-secrets
FIELD="${1:-}"

case "$FIELD" in
  sentry)    DEST="$DEST_DIR/sentry.env" ;;
  supabase)  DEST="$DEST_DIR/supabase.env" ;;
  powersync) DEST="$DEST_DIR/powersync.env" ;;
  axiom)     DEST="$DEST_DIR/axiom.env" ;;
  *)
    echo "write-secret.sh: unknown field '$FIELD' -- must be one of sentry|supabase|powersync|axiom" >&2
    exit 1
    ;;
esac

TMP="$(mktemp "$DEST_DIR/.tmp.XXXXXX")"
# Read stdin straight to the temp file -- never assign it to a shell
# variable, which would put the value in this process's own environment
# and widen who can read it via /proc/<pid>/environ.
cat > "$TMP"
chown root:orchestrator-svc "$TMP"
chmod 0440 "$TMP"
mv -f "$TMP" "$DEST"
