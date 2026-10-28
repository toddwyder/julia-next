# Dashboard worker proof

This package owns the SDK and DuckDB dependencies independently of the dashboard app. CI discovers its locked dependency owner through `node scripts/test-owners.mjs --plan`. It installs the worker lockfile and runs `run-build.test.mjs` in the local package-test job. There is no app import or deployment in this PR.

## Run one build

Pass `run-build.mjs` a JSON file with `id`, absolute `runDir`, absolute repository-root `cwd`, absolute `sourceAppData`, `model`, `helperModel`, `effort`, `prompt`, and `deadlineMs`. Effort is Small, Medium, Large, or Unlimited. The run directory must not exist. Each invocation must use a separate process and directory. The source holds `auth.json` and `settings.json`. They are copied into the run, never printed or committed.

Run credential-dependent commands through `node scripts/julia-agents.mjs -- <command>`. Set `DASHBOARD_PROGRAM_STOP` to the program's absolute STOP path before launching. STOP blocks new writes and interrupts active work. The worker calls SDK shutdown to flush its trace database.

## Read existing proof without providers

Run `node dashboard/scripts/effort-read.mjs SOURCE NEW_OUTPUT`. The source is an existing probe directory. The output must not exist. This command reads each run's original DuckDB database and SDK events. It writes a new report without changing earlier proof files. Exit 1 means the required twelve-run helper and trace proof is incomplete. It does not make provider calls.

## Verification limits

The inherited twelve-run matrix used GPT-6.1 Sol after the configured DeepSeek account failed authentication. Its workspaces were inside the program repository, so SDK project detection climbed to that repository and loaded its instructions. Only Small-1, Medium-1, and Medium-2 emitted a helper start. Unlimited turns suspended despite exit code zero. The original trace query failed because `startedAt` is not a column. Those failures remain in the original evidence directory.

The corrected worker requires the repository root as its working directory. New probe workspaces get their own Git repository. Both SDK home configuration and session home state point at the run's config home. Suspended turns fail instead of reporting completion. These changes do not retroactively validate the inherited matrix.

Real reset recovery, real observer survival, helper effort propagation, and the large-write recovery remain UNVERIFIED until observed through the worker. Unit fixtures establish local behavior only. No output-token cap is configured.

## Installed source pins

The lockfile pins `@mastra/code-sdk` 1.14.0 and `@duckdb/node-api` 1.5.4-r.1. SDK facts were read from the installed package, not current online docs.

| Installed SDK file | SHA-256 |
| --- | --- |
| `dist/index.js` | `0130afeaca903687d774691b9d33634bed74411afe0c1488c030db369ed05da8` |
| `dist/onboarding/pack-activation.js` | `4858171256f8873b96682a38f3edc12c62291fefe202da11d91858ea3256b0fa` |
| `dist/thinking.js` | `ea1329acc622f881e4a1a6696500241c38b15e45f657c1ca5adc15c4735c2f2f` |
