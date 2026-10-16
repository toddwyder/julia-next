# Initialize a Ready card from local control page

This feature provides a no-terminal local control page for initializing a real Ready Linear card,
selecting the exact model and advertised effort for all four delivery roles, and creating one
durable restart-surviving run suspended at `ready-for-build` before any role or LLM runs.

## Sub-features

- `control-page-discovery` discovers live Ready Linear cards and current model/effort offers without inference or `role-defaults.json`.
- `browser-cancel` closes the form locally with no request and leaves the full persisted run collection and total count unchanged.
- `browser-start` validates the card and four role selections, creating exactly one durable restart-surviving run suspended at `ready-for-build` with no LLM invoked, and proves idempotence on repeat.
- `independent-readback` uses the validated read-only `GET /julia-control/api/runs` boundary to retrieve the suspended run and independently count all runs after process restart, without using Start.
- `structured-activity` measures actual Builder, Reviewer, Crash fixer, and Crash reviewer dispatches, LLM inference calls, Linear queries, and Linear mutations at production seams.

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
"exitCode=$driveExit" | Add-Content -Encoding utf8 (Join-Path $evidenceDirectory 'initialization-drive.txt')
if ($driveExit -ne 0) { throw "initialize-ready-card drive failed with exit code $driveExit" }
```

- **Initialize the card.** Observable success is exit code `0`, one durable run created in
  `ready-for-build`, snapshot containing the exact four confirmed selections and card, no LLM
  invoked, repeat Start returning the same run with `resumed: true`, Cancel closing locally with
  no browser request and identical before/after persisted state, and read-only boundary readback
  confirming the complete persisted run collection and total count upon process restart. The same
  activity meter must observe allowed Linear queries while measuring zero role dispatches, LLM
  inference calls, and Linear mutations; the captured browser console error list must be empty.
- **Retain proof.** `cancel-evidence.json`, `start-evidence.json`, `idempotence-evidence.json`,
  `readback-evidence.json`, `boundary-traces.json`, `control-server.log`, and `drive.json` remain readable in `$evidenceDirectory`.

## Gotchas

- The control server binds only to loopback (`127.0.0.1:43123`) and rejects non-loopback Host headers.
- The Pstack driver sets `JULIA_CONTROL_OPEN_BROWSER=0` for its captured launcher processes so only its Playwright browser drives the page; ordinary user launches still open the default browser.
- Builder and Reviewer must use different companies; Crash fixer and Crash reviewer must use different companies.
- Effort values must be selected only from route-advertised options (`low`, `medium`, `high`, `xhigh`, `max`).
- Cancel must produce no server request, run creation, validation, or Linear mutation.
- Start suspends at `ready-for-build` before any delivery role or LLM inference step.
- Cleaning up stops only run-captured processes, fails when any captured PID survives, and preserves retained evidence.
