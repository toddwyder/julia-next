# JUL-255 Start proof attempt

This directory records the first real Start run for JUL-255. The run did not produce a candidate and is not a successful proof.

## Start identity

Playwright drove `https://ovh.tail91f394.ts.net/julia-control`, selected JUL-255, selected ChatGPT-plan `gpt-6-sol` for orchestration, selected CommandCode `deepseek/deepseek-v4.1-flash` for coding, and clicked Start once. The accepted response pinned run `jul-255-8f8ccaead8ea3061a74db741c7f02452` to source `ab6e94a0464888118796083f9ec1302b65626e53`.

The browser recorded successful page, state, build-list, and Start requests. It recorded no console messages and no page errors. See [the Start response](start-response.json), [browser record](start-browser.json), [selected page](start-selected.png), and [running page](start-running.png).

The first browser preflight did not click Start. JUL-255 was visible but inadmissible because its approved description omitted the required `Key interfaces` field. The existing card was corrected with the marker file and Start page as its interfaces, remained in Ready, and then passed admission. The failed preflight is retained in [its browser record](preflight-browser.json) and [driver error](preflight-driver.stderr).

## Terminal result

The build failed before implementation when the request ledger refused the next Sol reservation. The worktree stayed clean at the source commit. `JUL-253-START-PRACTICE-2.txt` was never created, and no candidate commit exists. See [the job record](job.json), [receipt](receipt.json), [events](events.jsonl), and [request outcomes](requests.jsonl).

| Model | Settled requests | Input | Output | Cache read | API-equivalent debit |
| --- | ---: | ---: | ---: | ---: | ---: |
| `openai/gpt-6-sol` | 33 | 670153 | 4929 | 633600 | $1.516316000 |
| `commandcode/deepseek/deepseek-v4.1-flash` | 30 | 65819 | 13661 | 1195392 | $0.039725076 |
| Total | 63 | 735972 | 18590 | 1828992 | $1.556041076 |

The card ledger has zero holds and $0.443958924 remaining under its unchanged $2 ceiling. Every retained request is settled from provider-reported usage. The refused request was not charged. See [all ledger rows](ledger.json) and [the model totals](ledger-summary.tsv).

## Root cause

The internal builder treated host-owned Start, browser, server, and evidence duties as its feature-design scope. It reread the prior JUL-253 proof tree and ran two architecture explorations before reaching implementation. The growing Sol conversation required a $0.499130000 maximum reservation after only $0.443958924 remained. The ledger correctly refused it.

The source repair narrows the builder boundary to the card's repository change. The host continues to own the outer Start route, server state, and evidence capture. This attempt cannot be retried or represented as passing. A new proof requires a fresh approved practice card with its own ledger.

## Restoration

The original Tailscale Serve target `http://127.0.0.1:43126` was restored. The temporary candidate services were stopped. The main control and runner services remained active from `/home/ubuntu/julia-machine-main` at `fa95a1a41be69202dcc75b9cf1f753557ecb7a91`. See [the route before](serve-before.json), [candidate route](serve-candidate.json), and [restored route](serve-restored.json).
