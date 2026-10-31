# card-runner

Step 1 of the connected path in [docs/plans/path-forward.md](../../docs/plans/path-forward.md): a card's build evidence reaches Shipping by itself, and Shipping answers it.

The path runs as a Mastra workflow with three real steps:

1. `build` runs one headless Mastra Code session in a fresh worktree of `runner/card-<n>` cut from `origin/main`. The session builds the card, pushes, opens the pull request, and posts one Linear comment per acceptance criterion starting `Prove It Works:`.
2. `shipping-free` is the body of a `dountil` loop. It reads the card again, collects the evidence comments posted since the build started, and asks a free model for a verdict. It repeats on the free model until it gets a verdict the runner accepts.
3. `shipping-final` runs once on Kimi K3.1 Pro over the same head. Its verdict is the one the card keeps and the one the PR gate reads.
4. `record` posts both verdicts on the card, posts the final verdict block on the pull request, and writes `run.json`.

Shipping never sees the builder's chat. The evidence it judges is whatever the build wrote on the card.

## Running it

```sh
node scripts/julia-agents.mjs -- node ops/card-runner/run.mjs JUL-295
```

`--repo <path>` points at the checkout to cut worktrees from (default: cwd). `--run-dir <path>` keeps the run's records somewhere other than `/var/lib/julia-dashboard/state/runs/<CARD>` (override with `CARD_RUNNER_STATE_DIR`).

Each run keeps its records in the run dir: `run.json`, `steps.jsonl`, per-session DuckDB traces, and `app-data/` with its own `settings.json` and a copy of `auth.json`. A run cannot share threads or credentials with an interactive session.

## Models

| Job | Model | Cost |
| --- | --- | --- |
| Build, memory helpers (observer and reflector) | `mastracode/commandcode/reflection/beam:free` | $0 |
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

## Scope

This is step 1 only. It stops after Shipping answers. Remediation, preview, smoke, UAT, merge, live, and retro are the later steps in `path-forward.md` and are not in this workflow yet.
