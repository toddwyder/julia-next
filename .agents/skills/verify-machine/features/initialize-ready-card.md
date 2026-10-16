# Initialize a Ready card from local control page

This feature provides a no-terminal local control page for initializing a real Ready Linear card,
selecting the exact model and advertised effort for all four delivery roles, and creating one
durable restart-surviving run suspended at `ready-for-build` before any role or LLM runs.

## Sub-features

- `control-page-discovery` discovers live Ready Linear cards and current model/effort offers without inference or `role-defaults.json`.
- `browser-cancel` closes the form locally with no validation, persistence, run creation, dispatch, or Linear mutation.
- `browser-start` validates the card and four role selections, creating exactly one durable restart-surviving run suspended at `ready-for-build` with no LLM invoked, and proves idempotence on repeat.
- `independent-readback` independently reads back the suspended run and snapshot from storage after boundary restart.

## How to get to it (user POV)

- From the repository root, double-click `Start Julia Control Page.cmd` or run `.\scripts\start-julia-control-page.ps1` in PowerShell.
- The launcher runs with restricted Julia vault secrets (`LINEAR_API_KEY`, `COMMANDCODE_API_KEY`), binds only to loopback on port 43123, and opens `http://127.0.0.1:43123/julia-control` in the default browser.
- Review discovered Ready cards, change route, model, and effort for all four roles (Builder, Reviewer, Crash fixer, Crash reviewer), and click Start to initialize or Cancel to close.

## Driving it with start-julia-control-page.ps1 and browser

Preconditions:

- Doctor passes.
- Restricted vault resolution succeeds.
- The skill's run-owned evidence directory exists.
- The drive performs no Linear mutation or downstream delivery role execution.

```powershell
$startedAt = Get-Date -Format o
$cardId = $env:JULIA_VERIFY_CARD_ID
if (-not $cardId) { $cardId = 'JUL-230' }
$driveOutput = node .agents/skills/verify-machine/drive-initialization.mjs $evidenceDirectory $cardId 2>&1
$driveExit = $LASTEXITCODE
$driveOutput | Set-Content -Encoding utf8 (Join-Path $evidenceDirectory 'initialization-drive.txt')
if ($driveExit -ne 0) { throw "initialize-ready-card drive failed with exit code $driveExit" }
```

- **Initialize the card.** Observable success is exit code `0`, one durable run created in
  `ready-for-build`, snapshot containing the exact four confirmed selections and card, no LLM
  invoked, repeat Start returning the same run with `resumed: true`, Cancel closing locally with
  zero server requests and zero mutations, and independent readback confirming the persisted run
  upon boundary restart.
- **Retain proof.** `cancel-evidence.json`, `start-evidence.json`, `idempotence-evidence.json`,
  `readback-evidence.json`, `control-server.log`, and `drive.json` remain readable in `$evidenceDirectory`.

## Gotchas

- The control server binds only to loopback (`127.0.0.1:43123`) and rejects non-loopback Host headers.
- Builder and Reviewer must use different companies; Crash fixer and Crash reviewer must use different companies.
- Effort values must be selected only from route-advertised options (`low`, `medium`, `high`, `xhigh`, `max`).
- Cancel must produce no server request, run creation, validation, or Linear mutation.
- Start suspends at `ready-for-build` before any delivery role or LLM inference step.
- Cleaning up stops only run-captured processes and preserves retained evidence.
