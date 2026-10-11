# Mastra reviewer spike — do not merge

This removable spike answers whether CommandCode's `deepseek/deepseek-v4.1-flash` can use the three read-only PR tools and return Mastra-validated review JSON in one run.

Run it only through the established 1Password launcher, with `COMMANDCODE_API_KEY` resolved in its child environment:

```powershell
npm test
npm run review
```

It reviews only PR #282 at `8a0d87cbc9c56458c367a2cd2b6bae4083c48722`. It tries native structured output, then `jsonPromptInjection`, then a separate structuring pass using the same selected model. The runner makes at most three live agent runs. `artifacts/run-282.json` records mode, observed model/response identity, quote checks, and trace size. `traces/mastra-reviewer-spike.db` is local-only and is protected by an explicit `SensitiveDataFilter`.

Created files are limited to this directory. Remove it and its branch/PR after the spike.
