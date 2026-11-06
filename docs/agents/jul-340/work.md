# JUL-340 build record

Todd uses the Start screen to save the Lead model and every pstack role model. A Studio restart loads those picks, and a trace shows each model doing the assigned work.

## Result

The live picker check passed every criterion on 6 November 2026 at 02:06 UTC. The Lead ran on `commandcode/moonshotai/Kimi-K3.1-Pro`; the coding role and every helper ran on DeepSeek. [The saved proof](proof.json) holds each run id, trace id, model span, usage, saved verdict and mismatched verdict. [The scorecard](../../scorecards/JUL-340.md) states the measured Studio cost and why it is short of the whole build.

## What changed

- The Start screen opens at `/start` without a Ready card and shows the Lead and all 17 pstack role rows, each on the model it uses today. Save writes `~/.config/julia/lead-model` and `~/.config/julia/lead-role-models.md`.
- The Lead's setting accepts any of the three accounts' models. ChatGPT uses the Codex subscription provider, Claude uses the Claude subscription provider, and CommandCode uses the same raw model id route as the helpers. Sol stays the default.
- Studio creates one stock Mastra helper per role and per saved panel model. `helperKey` is defined once and shared with the trace check, so the tool name the Lead calls is the name the check reads.
- The picker offers 98 account models. The live controller registry lags CommandCode and omits Kimi K3.1 Pro, so the saved weekly catalogue fills the CommandCode rows the registry lacks.

## Feature playbook

- [x] Run `how` over the existing picker, Lead model setting, and Studio agent registration. Inherited from the stopped Codex run.
- [x] Run `architect` on the settings boundary and helper design. Inherited. Two independent sketches agreed on a separate Lead role file and registry-derived helpers.
- [x] Write the four-part throughput checkpoint below.
- [x] Delegate code writing to a subagent. The delegate owned the implementation and the first review; the parent owns the widened Lead route, the proof, the PR and CI.
- [x] Verify on the Start screen and Studio with real account models. The result is below.
- [x] Rebase into small, ordered commits.
- [x] Run Opening a PR and update pull request 451.
- [ ] Babysit to green.
- [ ] Shipping's independent rerun. That is the Shipping step, not this build.

## Throughput checkpoint

- **Blocking first steps.** The card, the installed Mastra helper API, the existing picker, the server runbook and the stopped run's record were read before changing anything.
- **Independent workstreams.** The parent owns design review, the Lead route, the proof and the PR. The code delegate owned the settings, helpers and checker in one pass because they share the role registry and file format.
- **Shared mutable state.** The Lead setting is `~/.config/julia/lead-model`; the role table is `~/.config/julia/lead-role-models.md`; Codex's own `~/.agents/pstack-models.md` is never written. The check saves through the browser and restores the files it found.
- **Smallest safe decomposition.** One delegate owns the picker and Studio wiring because both read the same role table. The parent reviews the diff and runs the independent proof.

## Design

`dashboard/config/roles.json` is the role registry. The Start screen reads the two settings files and validates every pick against the connected account catalogue before it writes. `machine/flow/role-models.mjs` reads the same table and builds one stock Mastra helper per scalar role and one per panel model. The Lead is a plain Agent that carries those helpers as its subagent tools.

The Lead model setting holds one account model id. `machine/flow/models.mjs` routes it through the same `agentModel` function the helpers use, so a CommandCode id reaches the CommandCode gateway and a Claude id reaches the Claude subscription provider. A missing or malformed setting fails at Studio start and names the installer.

## Proof

| Criterion | Check | Live result |
| --- | --- | --- |
| The Start screen opens at any time and shows the Lead and every pstack role. | The check opens `/start` in Chromium, reads the Lead row and all 17 role rows, and compares each model id with the saved setting. | 17 of 17 rows PASS. Each row's mismatched pick FAILs with its own assertion. |
| Every model saved for the Lead or a role answers one short request, and the check records which model answered. | The check records one answer for each model saved in the run's settings: the Lead pick and every role helper. The full picker list is saved as `accountLeadModels`. | 18 of 18 saved models PASS; every mismatched expected model FAILs. |
| Saving a pick for the Lead makes the next run use it and the trace names it. | The browser saves Kimi K3.1 Pro, then a temporary Studio starts from that file and the check reads the Lead's `flow-build` inference span. | `commandcode/moonshotai/Kimi-K3.1-Pro` PASS in the trace; the mismatched pick FAILs. |
| Every pstack role's helper does the work on its saved model. | The Lead is asked to delegate a string reversal to each role helper. The check requires the helper tool call, a nested `pstack-<role>-<n>` agent run, and a model inference on the saved model. | 17 of 17 helpers PASS on `deepseek-v4-flash` or `deepseek-v4.1-flash`; every mismatched expected model FAILs. |
| Each criterion has a check that fails on a mismatched pick and passes on the saved one. | `criterion5` in the proof compares every saved verdict and every mismatched verdict. | `screenSaved` PASS, `screenMismatch` FAIL, `listSaved` PASS, `listMismatch` FAIL, `leadSaved` PASS, `leadMismatch` FAIL, `rolesSaved` PASS, `rolesMismatch` FAIL. Shipping's rerun is pending. |

The check restored both settings files. `originalHashes` and `restoredHashes` match in the proof.

## Re-run

Run it from the repository root through the Julia wrapper, because the temporary Studio needs the CommandCode key:

```sh
node scripts/julia-agents.mjs -- npm run check:model-picker -- docs/agents/jul-340/proof.json
```

The check starts a temporary dashboard and two temporary Studio servers, saves through the real Start screen, reads the Studio traces, and restores the settings files it found. It starts no card and no workflow.

The live run began from a seeded role file with every role on DeepSeek, because the ChatGPT subscription window was exhausted. The check restored that file. The machine's own state before the build was Lead Sol and no role file; both were put back after the run. The Lead was saved as Kimi for the check, as the card's operator directed. The picker still offers the 8 ChatGPT models, which answer again when the account window resets.
