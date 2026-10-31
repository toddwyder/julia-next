# card-runner

Step 1 of the connected path in [docs/plans/path-forward.md](../../docs/plans/path-forward.md): a card's build evidence reaches Shipping by itself, and Shipping answers it.

The path runs as one Mastra workflow, held in Mastra storage, with six steps:

1. `build` runs one headless Mastra Code session in a fresh worktree of `runner/card-<n>` cut from `origin/main`. The session builds the card and pushes its branch, then hands over three files instead of opening the pull request itself: `pr/title.txt`, `pr/body.md`, and `build-done.json`. That last file is the only way a build says it is done.
2. `publish` reads those files and creates or edits the pull request with the title and description the build wrote.
3. `evidence-gate` checks that every acceptance criterion on the card has its own comment starting `Prove It Works:`. A criterion with no evidence sends the build back with the missing list, once by default. A build that still cannot show its work stops the run before Shipping starts.
4. `shipping` starts exactly one review on the card's Shipping model, named in the shared dashboard config. The judge writes its answer to `verdicts/<runId>.json`. That file is written before anything looks at it and is never deleted.
5. `record` posts the answer on the card and the pull request, then writes the run record with the run's tokens and cost. A failed post is recorded and loses nothing.
6. `approval` stops a PASS and suspends until Todd approves it. A FAIL or an unusable answer ends the run there and does not ask.

Shipping never sees the builder's chat. The evidence it judges is whatever the build wrote on the card.

## Running it

```sh
node scripts/julia-agents.mjs -- node ops/card-runner/run.mjs JUL-295
```

`--repo <path>` points at the checkout to cut worktrees from (default: cwd). `--run-dir <path>` keeps the run's records somewhere other than `/var/lib/julia-dashboard/state/runs/<CARD>` (override with `CARD_RUNNER_STATE_DIR`).

A build that finished outside this workflow leaves the same handover behind, and the runner picks it up:

```sh
node scripts/julia-agents.mjs -- node ops/card-runner/run.mjs JUL-295 --ship-only --branch feat/jul-295-thing
```

`--ship-only` skips the build session. It reads `build-done.json` in the run dir, adds a worktree at the branch the build pushed, and starts at the same handover a self-run build leaves: publish, then the evidence gate, then Shipping.

The run id is printed when the run starts. It is the handle for the three commands that act on a run that already exists:

```sh
node scripts/julia-agents.mjs -- node ops/card-runner/run.mjs --resume JUL-295-1761900000000
node scripts/julia-agents.mjs -- node ops/card-runner/run.mjs --approve JUL-295-1761900000000
node scripts/julia-agents.mjs -- node ops/card-runner/run.mjs --repost JUL-295-1761900000000
```

`--resume` restarts a run the process left unfinished. Mastra re-runs the step that stopped and keeps the steps before it. `--approve` says yes to a run that is suspended at the approval step; a run waiting there stays waiting until this runs. `--repost` sends the kept answer again without asking a model anything.

Each run keeps its files in the run dir: `mastra.db` (the workflow snapshot), `records/<runId>.json` (the run record), `verdicts/<runId>.json` (the kept answer), per-session DuckDB traces, and `app-data/` with its own `settings.json` and a copy of `auth.json`. A run cannot share threads or credentials with an interactive session.

## Models

Every model comes from `dashboard/config/defaults.json`, the same file the dashboard reads. The top-level `shipping` key is the review model; the `runner` block holds the build and memory models, the evidence attempts, and the session timeout. Editing that file changes the next run without touching code.

| Job | Key |
| --- | --- |
| Build, build-back, memory helpers (observer and reflector) | `runner.build`, `runner.memory`, `runner.helper` |
| Shipping review | `shipping` |

The memory models are pinned in the run's settings through `observerModelOverride`, `observerModelSelection`, `reflectorModelOverride`, and `reflectorModelSelection`, so every observation and reflection request goes to the configured model. No request reaches Mastra's own default, which needs a Google credential this machine does not have.

Shipping must run on a different model from the builder. The PR gate can only see the names in the verdict, so it checks `builder !== verifier`.

## Verdicts

A verdict is one object:

```json
{"juliaShippingVerdict":1,"card":"JUL-295","head":"<head commit>","verdict":"PASS","builder":"<model>","verifier":"<model>","criteria":[{"criterion":"<the card's words>","verdict":"PASS","note":"<what the verifier saw>"}]}
```

The runner refuses a verdict that names another card, another head, the same model as the builder, a PASS with a failing criterion, a FAIL with nothing failing, or one that leaves a card criterion unanswered. The review gets one attempt: a broken judge is an error, never a second review.

Shipping is told to write every FAIL note in three parts: the command or action it ran, what it expected, and what it saw instead. A FAIL note without those parts is a note the runner cannot use, so the prompt is the enforcement and the verdict only has to be a real verdict.

## Scope

This is step 1 only. It stops after Shipping answers and Todd approves. Remediation, preview, smoke, UAT, merge, live, and retro are the later steps in `path-forward.md` and are not in this workflow yet.
