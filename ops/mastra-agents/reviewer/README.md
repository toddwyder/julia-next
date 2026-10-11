# Mastra review-only agent

The review-only laptop runner starts this worker with the per-card reviewer
configuration (default: CommandCode `deepseek/deepseek-v4.1-flash`). It reads
candidate files lazily through immutable, read-only Git tools, returns a
structured verdict, and preserves the runner's quote validation.

Run it only through the established 1Password launcher, with
`COMMANDCODE_API_KEY` resolved in its child environment:

```powershell
npm test
npm run review
```

The worker has a private card memory scope, Unicode normalization, warn-only
prompt-injection detection, a best-effort $1-per-agent-per-card cost guard, and
local traces protected by `SensitiveDataFilter`. It deletes the review thread
and transient local database after each run.
