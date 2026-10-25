# Diagnosis: Start page offered only CommandCode models

URL: `https://ovh.tail91f394.ts.net/julia-control`
Reported: 25 October 2026, around 05:39 UTC.
Symptom: the model select listed CommandCode models only; Claude and ChatGPT subscription models were absent.

## The cause

A deploy-window mismatch between old code and new settings.

PR #333 merged at `2026-10-25T05:38:48Z`. The machine updater fast-forwarded
`/home/ubuntu/julia-machine-main` to that merge before restarting the control service at
`05:40:59`. During that window the old control process (`PID 946157`, old code) read the new
`machine-settings.json`, which no longer contains a `models` block. The old
`stockSubscriptionOffers()` built its subscription offers exclusively from
`settings.models`, so it returned no Claude or ChatGPT offers. CommandCode survived because
it came from the live `/provider/v1/models` request, not from `settings.models`.

The running service's own discovery log shows the flip:

```
05:39:15  {"event":"model-discovery-completed","offerCount":95,"routes":["commandcode","openai-codex","claude"]}
05:39:39  {"event":"model-discovery-completed","offerCount":93,"routes":["commandcode"]}
05:41:04  {"event":"model-discovery-completed","source":"models.dev","offerCount":133,"routes":["claude","openai-codex","commandcode"]}
```

The middle line is the reported symptom: 93 CommandCode offers, no subscription offers.

## Red-first reproduction

Run from the repository root. The old offer code is `24378f0:ops/build-runner/connections.mjs`;
the new settings file is the deployed `machine-settings.json` with no `models` block.

| Code | Settings | Subscription routes |
| --- | --- | --- |
| old `stockSubscriptionOffers` | deployed `machine-settings.json` (no `models`) | `[]` |
| old `stockSubscriptionOffers` | pre-merge `machine-settings.json` (with `models`) | `openai-codex`, `claude` |
| new `discoverCatalogueOffers` | deployed `machine-settings.json` (no `models`) | `claude`, `openai-codex`, plus `commandcode` |

The first row is the red loop: old code plus the deployed settings produces exactly the
missing subscriptions. The third row is the fix: the catalogue code does not read
`settings.models` for availability.

The exact red command used:

```sh
git show 24378f0:ops/build-runner/connections.mjs > ops/build-runner/.debug-old-offers.mjs
node --input-type=module -e "
import { stockSubscriptionOffers } from './ops/build-runner/.debug-old-offers.mjs';
console.log(await stockSubscriptionOffers('/tmp/new-machine-settings.json'));
"
```

It printed `[]`. The temporary file was removed after the run.

## Hypotheses considered

1. **Subscription sign-ins missing or expired.** Falsified: the shared `AuthStorage` has
   `anthropic` and `openai-codex` OAuth slots; `isLoggedIn()` checks the slot type, and the
   live service read both after the restart.
2. **Deploy window: old code read new settings.** Confirmed by the service log flip and the
   deterministic old-code/new-settings reproduction above.
3. **Tailscale Serve stripping the model list.** Falsified: the same Tailscale URL returns
   133 offers now, and the request log shows the local control server answering.
4. **Catalogue provider filter dropping subscriptions.** Falsified: the new catalogue returns
   17 Claude, 34 ChatGPT and 82 CommandCode offers on the same settings file.
5. **Browser caching an old page.** Falsified: a fresh Playwright browser context sees all
   three groups and 133 options.

## Fix and regression

PR #333's catalogue code is live. It reads models.dev for Claude and ChatGPT and no longer
depends on `settings.models`; the worker hydrates settings from the catalogue instead.

The regression test is
`ops/build-runner/test/connections.test.mjs` → "subscription offers do not depend on a
settings.models block". Its fixture writes a settings file containing only `authPath`. On the
old code that test returns `[]`; on the current code it returns `claude` and `openai-codex`.

## Live evidence

`proof/start-page-tailscale.json` and `proof/start-page-tailscale.png` were captured from
`https://ovh.tail91f394.ts.net/julia-control` with
`node ops/build-runner/proof/start-page.mjs <url> <output-dir>`.

The capture shows 133 options:

- Claude subscription: 17
- ChatGPT plan: 34
- CommandCode: 82

The screenshot expands the real Orchestrator select so the three provider groups are visible
in one image.

## Not this bug

The page also logs a 400 from `/api/builds` for a saved job whose card description predates
the short card shape. That error is recorded in the capture but does not affect the model
list or Start form.
