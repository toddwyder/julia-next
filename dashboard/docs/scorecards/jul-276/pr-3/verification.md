# PR-3 verification: weekly model sweep, Start screen read only

Card: JUL-283. Plan: `docs/plans/jul-276-start-screen.md`, section "PR-3 The weekly model sweep,
and the Start screen read only". Branch `feat/jul-276-model-sweep`, base `origin/main` cd3e275.

Run on this server, 29 October 2026, from the `feat/jul-276-model-sweep` worktree.

## Where to look at it

The dashboard is its own Next app in `dashboard/`. Vercel builds the cookbook at the repository
root, so a preview URL such as
`https://julia-next-git-feat-…vercel.app/start/JUL-279` answers 404 inside the cookbook shell: that
address never could show this screen. The first version of this document handed over exactly such
an address without opening it.

The address that does serve it, dashboards running from this worktree:

```sh
cd /home/ubuntu/verifications/jul-276/pr-3/dashboard
DASHBOARD_STATE_DIR=/tmp/start-preview DASHBOARD_HOST=0.0.0.0 DASHBOARD_PORT=4314 \
  setsid node ../scripts/julia-agents.mjs -- node server.js
# http://ovh.tail91f394.ts.net:4314/start/JUL-279  (tailnet only, no sign-in)
```

`http://ovh.tail91f394.ts.net:4313/start/JUL-279` is the live dashboard built from `main`: it
answers, but shows the older read-only card with no prices. After this branch merges, 4313 carries
the screen below by itself.

Before any address is handed over, ask it what it serves:

```sh
cd dashboard && npm run check:start-address -- http://ovh.tail91f394.ts.net:4314/start/JUL-279
```

`OK … serves the Start screen.` or a `FAIL` that names the cause. The ten lanes below open a server
this build started on `127.0.0.1`; none of them ever opened a handed-over address, which is how the
wrong one reached Todd.

## What is in this slice

| File | What it does |
| --- | --- |
| `dashboard/config/accounts.json` | Three accounts: Claude subscription → `anthropic`, ChatGPT plan → `openai`, CommandCode grant → `mastracode/commandcode`. A fourth account is one line. |
| `dashboard/config/price-sources.json` | One pricing page per provider, each with the parser and the date read. |
| `dashboard/config/defaults.json` | Main session `openai/gpt-6.1-sol`, Shipping `anthropic/claude-opus-5-5`, effort `large`. |
| `dashboard/lib/models.js` | Price parsers, `mergeSweep`, `stateDir`, `readModels`, `startModels`, `priceLabel`. |
| `dashboard/lib/models.test.mjs` | Unit tests for the parsers, add/retire, the unpriced rule, sweep status and the price form. |
| `dashboard/scripts/sweep.mjs` | The weekly sweep: ask every account through `listAvailableModels()`, fetch each provider's own pricing page, merge, write `models.json` atomically, append one line per attempt to `sweep-log.jsonl`. |
| `dashboard/ops/julia-dashboard-sweep.service` + `.timer` | Oneshot sweep, `OnCalendar=Mon 04:00`, `Persistent=true` so a missed week catches up. |
| `dashboard/app/start/[card]/page.jsx` + `start.module.css` | Start screen, read only: card title, main session model + price, Shipping model + price, effort summary, four effort options with plain explanation, prices per account, empty and stale states. |
| `dashboard/scripts/install-service.mjs` | Installs the sweep unit and timer beside the dashboard's own. |

The sweep records a price only from the provider's own page, with the date it was read. A model
with no saved price is never written, and the sweep writes the exclusion to the log.

## Unit tests

`npm test` in `dashboard/`: **61 tests, 61 pass, 0 fail** (2.0 s). The model-sweep file is
`lib/models.test.mjs`, 11 tests:

- the saved Anthropic page parses to its real prices (Opus 5.5 4/20, Haiku 5.5 0.1/0.5)
- the saved OpenAI page parses to its real prices (gpt-6-astra 10/50, gpt-6.1-sol 2/10)
- the saved CommandCode page parses to its real prices (DeepSeek V4.1 Flash 0.15/0.6, Kimi K3.1 Pro 2/10)
- a page that changes shape fails loudly instead of returning nothing (three providers, three breakages)
- a model that appeared is added, one that vanished is retired, and the price date is stamped
- a model with no saved price is never written and is reported as excluded
- a model with no price on disk never reaches the Start screen
- the Start screen picks the saved defaults and falls back when one is gone
- the sweep writes beside the dashboard records, under the state folder
- readModels tells a missing, empty, stale and fresh sweep apart
- prices read input and output per million tokens in the approved form

`npm run lint`: clean.

## Live lanes

Ten lanes, every one run against a real server built from this branch, with the real sweep file
captured on 29 October 2026 at 06:13 UTC (54 models). Each lane ran on its own port and its own
state folder. Result: **10 of 10 pass**.

| Lane | What it proved | Evidence |
| --- | --- | --- |
| 1 | Phone 390×844: card title `Practice: JUL-276 …`, main session model + price, Shipping model + price, effort summary, all four effort options | `lane-1.png` |
| 2 | Desktop 1280×800: prices present, none cut, no sideways scroll | `lane-2.png` |
| 3 | Every price in the approved form `↓$input/$output↑`, main session price present, price explanation present | `lane-3.png` |
| 4 | Effort explanation reads exactly `How hard the models think. More brains is slower and costs more.`, and the screen has no control at all | `lane-4.png` |
| 5 | No control changes a setting, no non-GET request leaves the page, the state folder is byte-identical after clicking every effort row and reloading, no `last-start.json` appears | `lane-5.png` |
| 6 | Stale sweep (29 October read, aged to 19 October): the plain sweep-date line shows, the saved price still shows, no price is invented | `lane-6.png` |
| 7 | Empty `models.json`: the screen names the missing sweep and offers Back, and shows no price | `lane-7.png` |
| 8 | Back returns to the Ready list with the card still there and still Ready | `lane-8.png` |
| 9 | Lane 1 at 200% zoom: no sideways scroll, no cut price, every label whole and inside the viewport | `lane-9.png` |
| 10 | Two passes of the Start screen, the effort explanation and Back, with a clean console (no console error, no page error on any lane) | `lane-10.png` |

Lanes 1, 3 and 5 share one screenshot because all three show the same phone screen; lane 8 and
lane 10 share one because both end on the Ready list.

Walkthrough: `walkthrough.webm`, 39.5 s, phone size — the screen, the effort explanation opened,
Back to the Ready list, and the screen again after the sweep file was left untouched.

## Performance

`curl -o /dev/null -s -w '%{time_starttransfer}'` ten times per run against
`/start/JUL-279` on a freshly started server, three runs:

| Run | Median TTFB | Baselines met |
| --- | --- | --- |
| 1 | 18 ms | yes |
| 2 | 20 ms | yes |
| 3 | 21 ms | yes |

Baseline is 1,500 ms; the median must be at or under it in two of three runs. All three are
about 1/75 of the baseline.

## The sweep against the live accounts and pages

Run from this branch on the server with the Julia agents vault supplying the keys:

```
DASHBOARD_STATE_DIR=/var/lib/julia-dashboard node scripts/julia-agents.mjs -- node scripts/sweep.mjs
Swept 54 models at 2026-10-29T13:46:04.077Z.
```

- accounts answered: Claude subscription 17 models, ChatGPT plan 51, CommandCode grant 2
- written: 54 models, each with `inputPerMillion`, `outputPerMillion`, `priceSource`, `priceReadAt`
- log: 71 lines — 54 `added`, 16 `excluded` (`reason: no saved price`, e.g. `openai/gpt-4`, `openai/chatgpt-image-latest`), 1 `sweep` summary
- `models.json` written atomically (`<path>.<pid>.tmp` then rename), so a killed sweep leaves the old file intact
- defaults resolved to `openai/gpt-6.1-sol` (main session) and `anthropic/claude-opus-5-5` (Shipping), effort `large`

## Decisions recorded while building this slice

1. **Where the sweep writes.** `models.json` and `sweep-log.jsonl` sit in
   `<DASHBOARD_STATE_DIR>/state`, beside `build.json` and `watchdog.json`, because `lib/state.js`
   is the one place that decides where dashboard records live. The first draft wrote them in the
   folder root; that was corrected and covered by a test.
2. **Effort carries brains, not dollars.** The card's done-means asks for an "effort summary with
   prices". Decision 0007 says brains show effort, never dollars, and the prices of the models
   that effort applies to are already in the same summary block. So the effort row reads `Large`,
   and the four options read brains and a name. No dollars were put on an effort option.
3. **The sweep timer is not enrolled on this server yet.** The timer and service are in the repo
   and install with `scripts/install-service.mjs`, but enrolling them now would point them at
   `/home/ubuntu/julia-dashboard`, which does not carry `scripts/sweep.mjs` until this branch
   merges. Enrolment happens with the deploy after merge, so no timer fails in the meantime.
4. **A card is shown only while it is Ready.** The Start screen asks Linear for the card; the card
   in the lanes is `JUL-279` (Practice: JUL-276 …), which is Ready.

## Not proved here

- The sweep has not yet run on its own timer; the live run above was manual.
- Nothing on the Start screen changes a model or an effort — that is the next slice's work, and
  lane 5 proves it cannot happen here.
