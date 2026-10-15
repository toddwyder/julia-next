# Delivery-machine verification map

This is the generated map of the Windows delivery machine's working user-facing behavior today.
It was built from repository **docs**, exposed **commands**, existing **tests**, and the **laptop
installed state** observed during the recorded `create-verification-skill` interview. A command that
is pending, administrative, composite, or currently broken is accounted for below and is not shown
as a working feature.

## Baseline preconditions

- Work from the repository root on Todd's Windows laptop.
- Create a unique `.artifacts/verify-machine/<run-id>` evidence directory.
- Run `verify-machine doctor` and require the exact candidate identity plus five healthy permanent
  prerequisites.
- Use only `scripts/julia-vault-windows.ps1` for a command requiring Julia vault secrets.
- Do not drive shared real Julia configuration while another delivery owns it.
- Never change or clean up a permanent machine part, sign-in, real configuration, or the inventory.

## Driving conventions

- Start every feature from a passing Doctor record.
- Treat each PowerShell block as literal and retain stdout, stderr, exit code, and timestamps.
- Exercise the real user command and real service boundary; tests and fixtures are not proof.
- Stop only PIDs captured by the run. Retain evidence after cleanup.
- A broken or excluded command does not become verified through a different entry point.

## Proof and skip reporting

- Record the feature ID and exact command with every artifact.
- Require Doctor's commit and dirty-tree digest to match the candidate.
- Capture the action and resulting state, not only a final summary.
- Record relevant side effects and an independent readback for persistence.
- Report an unavailable command with its observed failure and precondition; do not call it working.

## Feature entry contract

Each feature file has exactly four H2 sections in this order: `Sub-features`,
`How to get to it (user POV)`, `Driving it with <real driver>`, and `Gotchas`. Its drive uses a
literal PowerShell command and states the observable success result.

## Working features

- [Check permanent prerequisites](./check-permanent-prerequisites.md) checks candidate identity and
  every installed permanent delivery prerequisite without changing them.
- [Verify restricted secrets](./verify-restricted-secrets.md) proves the provisioned restricted
  account resolves Julia references without revealing values.
- [Run a named-secret command](./run-named-secret-command.md) gives one approved executable only the
  requested secret fields and proves a real Linear card read.

## Command accounting

| Exposed command | Feature or reason it is not one |
| --- | --- |
| `verify-machine doctor` | `check-permanent-prerequisites.md` |
| `verify-machine rehearsal` | Retained aggregate paid diagnostic, not one user feature; run only when a card explicitly requires every live route. Current route health was not established by this interview. |
| `julia-vault-windows.ps1 -Verify` | `verify-restricted-secrets.md` |
| `julia-vault-windows.ps1 -SecretNames ... -RunArguments ...` | `run-named-secret-command.md` |
| `julia-vault-windows.ps1 -JuliaArguments ...` | Routes to the `connections`, `models`, and `init` commands accounted for below; none currently qualifies as a working feature. |
| `julia-vault-windows.ps1 -Operation readIssue` | Legacy Linear-read compatibility entry point; the least-privilege named-secret read is mapped in `run-named-secret-command.md`, so this is not a separate feature. |
| `julia-vault-windows.ps1 -Operation init` | Default internal selector used with `-JuliaArguments`; its exposed Julia commands are accounted for below. |
| `julia-vault.mjs init/readIssue/verify/run` | Internal dispatcher operations. On Windows they fail closed unless reached through `julia-vault-windows.ps1`; their supported wrapper paths are mapped or accounted for above. |
| `julia-vault.mjs migrate` | Operator-only credential migration; it can create vault items and configuration, so it is not a routine verification feature. |
| `connections list/add/reconnect/test/disable/remove` | Unavailable today: real `connections list` exited 1 because the installed persisted records use the retired shape. |
| `models list/save` | Unavailable today: real `models list` exited 1 because the installed role-defaults file is absent; Claude selection probes also failed. |
| `init` inspect/Cancel | Unavailable today because current connection/default prerequisites are not healthy. |
| `init Start` and resume | Pending implementation and verification under the repository instructions; verification does not authorize delivery. |
| `julia-vault-windows.ps1 -Provision` and vault migration | Operator-only account creation or credential migration, not routine verification features. |

## Interview sources

- Docs: `AGENTS.md`, `docs/agents/work-execution.md`, `docs/agents/julia-secret-vault.md`, and
  `docs/agents/permanent-machine-parts.json` read-only.
- Commands: `scripts/julia-vault-windows.ps1`, `scripts/julia-vault.mjs`,
  `scripts/linear-cli.mjs`, `ops/mastra-agents/reviewer/src/mastra/cli.ts`, and
  `ops/mastra-agents/reviewer/src/mastra/verify-machine.ts`.
- Tests: `scripts/julia-vault.test.mjs`, `scripts/verify-machine-skill.test.mjs`, and
  `ops/mastra-agents/reviewer/test/verify-machine.test.ts`.
- Laptop installed state: Node, Git, Windows PowerShell, the restricted vault bootstrap and
  configuration, Doctor's five-part check, and captured real command results.
