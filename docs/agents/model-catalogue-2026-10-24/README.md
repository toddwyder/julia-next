# Model catalogue — 24 October 2026

Todd's decision: no hand-edited model list. The Start page offers every model from exactly
Claude (subscription), ChatGPT (subscription) and CommandCode, and nothing else. Models,
prices and limits come from Mastra's model registry and its models.dev catalogue; where a
provider is missing there, from that provider's own published model list and prices. A model
with no published price is refused.

## What changed

- `ops/build-runner/catalogue.mjs` builds one catalogue from `https://models.dev/api.json`
  for the Anthropic, OpenAI and CommandCode providers. CommandCode's live
  `/provider/v1/models` list and its published pricing rows fill models models.dev does not
  carry (Beam, for example). A model with no published price is refused.
- The Start page (`discoverControlPageState`) reads that catalogue only. Antigravity and the
  Claude ACP bridge no longer contribute offers.
- `machine-settings.json` no longer contains a model list. The worker and job runner hydrate
  `settings.models` and the CommandCode provider's model list from the catalogue.
- The stock SDK's custom-provider path dispatches OpenAI chat only, so CommandCode's
  messages-only Claude entries are refused with a reason. Claude remains available on the
  Claude subscription route.
- Claude's stock conversation cache writes one-hour entries. The published one-hour write
  rate is twice the input rate, not models.dev's five-minute write rate, so the catalogue
  maps it that way.
- The request output bound is 8192 tokens, taken as a slice of the published maximum so a
  priced request stays bounded inside the $2 card cap.
- Pstack helpers are built from the models the selected playbook names, not from every
  priced model in the catalogue.

## Proof

`proof/catalogue-offers.json` is a live catalogue read: 133 offers, exactly the three routes,
17 Claude, 34 ChatGPT and 82 CommandCode, with every offer carrying a published price and
bounds.

`proof/subscription-requests.json` is two real requests through the stock Claude subscription
sign-in, settled on the card ledger at API prices:

| Model | Result | Usage | Settled |
| --- | --- | --- | --- |
| Claude Opus 5.5 | `PROOF_CLAUDE_OPUS_5_5` | 4 input, 22 output, 17,377 one-hour cache writes | $0.139472 |
| Claude Sonnet 5.5 | `PROOF_CLAUDE_SONNET_5_5` | 4 input, 22 output, 17,377 one-hour cache writes | $0.069736 |

Both requests are `settled`, `heldNano` is 0, the account is not stopped, and the card spent
$0.209208 of its $2.00 ceiling. No Anthropic API key was present; the stock `AuthStorage` OAuth
sign-in served both requests.

## Live Start page

The deployed page at `https://ovh.tail91f394.ts.net/julia-control` now lists 133 options:
17 Claude subscription, 34 ChatGPT plan and 82 CommandCode. The live capture is
`proof/start-page-tailscale.png`; `proof/start-page-tailscale.json` records the option counts.
The redeploy that first exposed the page also opened a short window where the old control
process read the new settings file (no model list) and offered CommandCode only. The timeline,
red-first reproduction and regression test are in [diagnosis.md](./diagnosis.md).

## Reproduce

```sh
node scripts/julia-agents.mjs -- node ops/build-runner/proof/model-catalogue.mjs
node scripts/julia-agents.mjs -- node ops/build-runner/proof/subscription-models.mjs
node ops/build-runner/proof/start-page.mjs https://ovh.tail91f394.ts.net/julia-control \
  docs/agents/model-catalogue-2026-10-24/proof
```

The local adapter fixture `ops/build-runner/settings.json` is unchanged and is not used by the
Start page or the production runner. Production uses `machine-settings.json` plus the
catalogue.
