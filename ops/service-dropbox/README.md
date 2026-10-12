# Retained seat launchers

The OVH credential drop-box service and privileged writer are retired and no
longer live in this repository. This directory retains only the seat launchers,
their read-only secret-file helper, and the checked-in CommandCode Pi model
fragment because the laptop runner still imports them.

- `run-pi-seat.mjs` launches the retained Pi seats.
- `run-agy-seat.mjs` launches the retained Gemini seat.
- `read-secret.mjs` reads one known secret field without invoking a shell.
- `pi-models.commandcode.json` is the non-secret provider shape required by the
  retained Pi reviewer seats.

Stage three deletes these files when the Mastra workflow replaces the old
runner. They are not an executable fallback for the disabled JUL-223 reviewer.
