# Julia delivery-machine verification map

This maintained index was generated with Pstack's `create-verification-skill`. It maps only
capabilities that exist at the candidate revision. Planned delivery/release behavior, retired
Factory behavior, and unavailable commands are not presented as working features.

## Built from

- **Docs:** `AGENTS.md`, `docs/agents/init.md`, `docs/agents/julia-secret-vault.md`,
  `docs/agents/runner-tests.md`, `docs/agents/work-execution.md`,
  `docs/agents/jul-225-framework-map.md`, and accepted ADR 0021.
- **Commands:** `ops/mastra-agents/reviewer/src/mastra/cli.ts`,
  `ops/mastra-agents/reviewer/src/mastra/verify-machine.ts`, `scripts/julia-vault.mjs`,
  `scripts/julia-vault-windows.ps1`, package scripts, and the runner-suite inventory.
- **Tests:** `ops/mastra-agents/reviewer/test/jul-225.test.ts`,
  `ops/mastra-agents/reviewer/test/verify-machine.test.ts`, and the tests discovered by
  `node scripts/julia-runner-suite.mjs --list`.
- **Laptop installed state (2026-10-15):** Node 24.14.1, npm 11.11.0, Git 2.53.0.windows.2,
  GitHub CLI 2.97.0, Antigravity CLI 1.3.5, Claude Code 2.1.284, Codex CLI 0.162.1,
  Windows PowerShell 5.1.26100.9711, successful restricted-vault verification, and Doctor reporting
  all five permanent prerequisites present. These version facts describe the interview; Doctor is
  authoritative for each run.

## Driving conventions

- Run every recipe from the repository root after Doctor passes.
- Use the restricted Windows vault launcher whenever a command needs a Julia secret.
- Use an isolated configuration directory for recipes that write configuration.
- Capture action and result, exit code, candidate identity, and side effects in run evidence.
- Never run a delivery Start merely to verify the machine. Start needs separate card authorization.
- Never mutate a permanent part, sign-in, or the real Julia configuration during cleanup.

## Command coverage

| Exposed command | Feature or reason it is not a feature |
| --- | --- |
| `connections list/add/reconnect/disable/remove/test` (also `$connections`) | Manage model connections |
| `models list/save` (also `$models`) | Discover and choose role models |
| `init JUL-nnn` and `init JUL-nnn Cancel` (also `$init`) | Inspect a complete Ready card and cancel without dispatch |
| `init JUL-nnn Start` and resume | Pending adapted-runner delivery behavior; binding `AGENTS.md` prohibits using or presenting it as verified until its complete laptop suite passes |
| `verify-machine doctor` | Check permanent prerequisites |
| `verify-machine rehearsal EVIDENCE_PATH` | Verification driver that composes connection, model, and card-decision features; it has no separate operator outcome |
| `julia-vault-windows.ps1 -Verify/-JuliaArguments/-SecretNames ... -RunArguments ...` | Launch with restricted Julia secrets |
| `julia-vault.mjs init/verify/run` | Internal dispatcher operations reached only through the restricted Windows launcher feature |
| `julia-vault-windows.ps1 -Provision` and `julia-vault.mjs migrate` | Account/bootstrap administration, not ordinary machine features; both require explicit operator/account authorization |
| `julia-vault.mjs readIssue` | Compatibility read-only Linear lookup; card reads are covered by the card-decision feature and new delivery uses `init` |
| App/package scripts, tests, `julia-runner-suite`, and worker tool updates | Development, guard, or internal preflight commands rather than operator-facing features |
| Antigravity seat and delivery recovery/release helpers | Internal recovery implementation; the adapted runner remains pending verification and is not presented as working |
| Former Factory commands and routes | Retired and prohibited; intentionally absent |

## Feature entry contract

Each feature file has exactly the four Pstack sections in order. Its `Driving it with` heading names
the real command, and the recipe states the observable success condition.

## Features

- [Check permanent prerequisites](./check-permanent-prerequisites.md) confirms recorded machine parts and candidate identity.
- [Launch with restricted Julia secrets](./launch-with-restricted-secrets.md) confirms service-account isolation and masked resolution.
- [Manage model connections](./manage-model-connections.md) covers the persisted connection lifecycle and live connection check.
- [Discover and choose role models](./choose-role-models.md) covers current offers and saved four-role defaults.
- [Inspect and cancel a card start](./decide-card-start.md) covers a real Ready-card read, displayed limits, and cancellation without delivery.
