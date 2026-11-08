# JUL-345 build record

Todd picks a model on the Start screen, and that model answers in the next Studio run with Studio left running.

## Result

The rebased candidate passes the two defects' red-first checks, the whole picker check, and two live Studio runs that differ only by the branch. On main the saved pick never reaches the run record. On the candidate it does, with no Studio restart.

## What changed

- `Save` sends the whole screen, writes both settings files, reads them back, and fails unless the read-back equals the choice. A Save with nothing changed still writes and still confirms.
- The Lead's `model` and its helper `agents` are functions Mastra resolves at each call, so a saved pick reaches the next call with Studio up. `~/.agents/pstack-models.md` is never read or written.
- `dashboard/lib/roles.js` owns `roleModelIds` and `picksEqual`. The picker and `machine/flow/role-models.mjs` read a saved role line through the same function.
- The Start screen drops the restart wording and shows no "Saved" line on a fresh load.

## Red first

Both causes were reproduced on `main` before the change, then the same commands were run on the candidate.

`main`, one agent build and a rewritten models file. The next call keeps the old model.

```json
{
  "lead": { "before": "gpt-6.1-sol", "saved": "openai/gpt-5.4", "after": "gpt-6.1-sol" },
  "helper": { "before": "deepseek/deepseek-v4.1-flash", "saved": "commandcode/moonshotai/Kimi-K3.1-Pro", "after": "deepseek/deepseek-v4.1-flash" }
}
```

The candidate, same script:

```json
{
  "lead": { "before": "gpt-6.1-sol", "saved": "openai/gpt-5.4", "after": "gpt-5.4" },
  "helper": { "before": "deepseek/deepseek-v4.1-flash", "saved": "commandcode/moonshotai/Kimi-K3.1-Pro", "after": "moonshotai/Kimi-K3.1-Pro" }
}
```

`main`, the unchanged Save as the old page sent it:

```json
{ "patch": "{}", "wrote": false, "updatedAt": null, "leadMoved": false, "pstackMoved": false }
```

The candidate's `an unchanged Save writes both files again and reads the choice back` test asserts both files' modified times move and the read-back equals the choice.

## Proof

| Criterion | Check | Result |
| --- | --- | --- |
| Save records every pick shown, including an unchanged Save, and confirms the saved picks match the screen. | `npm run check:model-picker` opens the real Start screen, saves twice, reloads, and compares every row. | 17 of 17 rows PASS, both Saves return 200, the second Save moves both files' modified times, the reload shows the saved picks. Every row's mismatched pick FAILs. |
| With Studio running, the next card run uses the last saved picks for Lead and every helper, and the run record names the model requested and the model the provider reports answering. | One Studio boot runs Lead, saves a different Lead pick, and runs Lead again. A second boot runs all 21 helper choices on their saved models. | Live Save: the second run's span and metric name the saved pick with `restarted: false`. 21 of 21 helpers answer on their saved model. |
| Two real Studio runs on Todd's picks, one on main and one on the change, show the saved pick missing from main's record and present in the change's record. | The same script on both trees: run Lead, save `commandcode/moonshotai/Kimi-K3.1-Pro`, run Lead again on the same process, then read both traces. | `main`: both runs `openai.responses/gpt-6.1-sol`, metric `openai/gpt-6-1-sol`, saved pick absent. Candidate: first run Sol, second `commandcode/moonshotai/Kimi-K3.1-Pro`, metric `commandcode/moonshotai/kimi-k3.1-pro`. |
| The proof runs use a small practice card, so they cost little of Todd's quota. | Each run is one short instruction with one step and no tools. The full picker check is the only long one. | 2 Lead runs per side, each about 12.7k input tokens and under 60 output tokens. |
| Todd receives screenshots and a 30 to 60 second video. | `media/*.png` and `media/start-save-and-record.mp4`. | Start screen before Save, dirty, after Save, unchanged Save, reloaded, and the run record. |

The picker check restored both settings files (`restoredHashes` equals `originalHashes`). The live comparison restored them too, and its report records `settingsRestored: { pstack: true, lead: true }`.

## Server change

The `Notification` hook in `/home/ubuntu/.mastracode/hooks.json` ran `julia-dashboard/scripts/stop-ping.mjs --global`, and that script left main in #484. The entry is deleted. The file now holds only the `SessionStart` retry-fix hook. The previous file is saved at `~/.local/state/julia-scratch/jul-345-proof/hooks.before.json`.

## Re-run

```sh
node scripts/julia-agents.mjs -- npm run check:model-picker -- docs/agents/jul-345/proof.json
node /home/ubuntu/.local/state/julia-scratch/jul-345-proof/live-compare.mjs <checkout> main http://127.0.0.1:4111
node /home/ubuntu/.local/state/julia-scratch/jul-345-proof/live-compare.mjs <checkout> change
```

The media lane is `~/.local/state/julia-scratch/jul-345-proof/media-lane.mjs`; it boots its own dashboard and Studio and restores the settings when it exits.
