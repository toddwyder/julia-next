# card-runner

Step 1 of the connected path in [docs/plans/path-forward.md](../../docs/plans/path-forward.md): a card's build evidence reaches Shipping by itself, and Shipping answers it.

The path runs as a Mastra workflow with six steps:

1. `build` runs one headless Mastra Code session in a fresh worktree of `runner/card-<n>` cut from `origin/main`. The session builds the card and pushes its branch, then hands over three files instead of opening the pull request itself: `pr/title.txt`, `pr/body.md`, and `build-done.json`. That last file is the only way a build says it is done.
2. `publish` reads those files and creates or edits the pull request with the title and description the build wrote.
3. `evidence-gate` checks that every acceptance criterion on the card has its own comment starting `Prove It Works:`. A criterion with no evidence sends the build back with the missing list, once by default. A build that still cannot show its work stops the run before Shipping starts.
4. `shipping-free` is the body of a `dountil` loop. It reads the card again, collects the evidence comments posted since the build started, and asks a free model for a verdict. It repeats on the free model until it gets a verdict the runner accepts.
5. `shipping-final` runs once on Kimi K3.1 Pro over the same head. Its verdict is the one the card keeps and the one the PR gate reads.

6. `record` posts both verdicts on the card, posts the final verdict block on the pull request, and writes `run.json`.

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

Each run keeps its records in the run dir: `run.json`, `steps.jsonl`, per-session DuckDB traces, and `app-data/` with its own `settings.json` and a copy of `auth.json`. A run cannot share threads or credentials with an interactive session.

## Models

| Job | Model | Cost |
| --- | --- | --- |
| Build, build-back, memory helpers (observer and reflector) | `mastracode/commandcode/reflection/beam:free` | $0 |
| Free Shipping passes | `mastracode/commandcode/stealth/glyph-cluster:free` | $0 |
| Final Shipping pass | `mastracode/commandcode/moonshotai/Kimi-K3.1-Pro` | paid |

The memory models are pinned in the run's settings through `observerModelOverride`, `observerModelSelection`, `reflectorModelOverride`, and `reflectorModelSelection`, so every observation and reflection request goes to the free model. No request reaches Mastra's own default, which needs a Google credential this machine does not have.

Shipping must run on a different company's model from the builder. Beam, Glyph Cluster, and Kimi are all CommandCode-served models; the builder runs on Beam and the final verifier on Kimi, so the pair differs in model while the credential stays the same. The PR gate can only see the names in the verdict, so it checks `builder !== verifier`.

## Verdicts

A verdict is one object:

```json
{"juliaShippingVerdict":1,"card":"JUL-295","head":"<head commit>","verdict":"PASS","builder":"<model>","verifier":"<model>","criteria":[{"criterion":"<the card's words>","verdict":"PASS","note":"<what the verifier saw>"}]}
```

The runner refuses a verdict that names another card, another head, the same model as the builder, a PASS with a failing criterion, a FAIL with nothing failing, or one that leaves a card criterion unanswered. A refused free pass costs nothing and the loop tries again. The final pass gets one attempt: a broken judge is an error, never a verdict.

Shipping is told to write every FAIL note in three parts: the command or action it ran, what it expected, and what it saw instead. A FAIL note without those parts is a note the runner cannot use, so the prompt is the enforcement and the verdict only has to be a real verdict.

## Scope

This is step 1 only. It stops after Shipping answers. Remediation, preview, smoke, UAT, merge, live, and retro are the later steps in `path-forward.md` and are not in this workflow yet.
