---
name: verify-machine
description: Verify Julia delivery prerequisites and the real Antigravity, Claude, and CommandCode routes on Todd's Windows laptop.
---

# Verify machine

Run from the repository root. Evidence belongs under `.artifacts/verify-machine/<run-id>/` and is
never removed by cleanup. The permanent-part inventory is
[`docs/agents/permanent-machine-parts.json`](../../../docs/agents/permanent-machine-parts.json);
no cleanup may remove, uninstall, sign out, or rewrite anything it lists.

## Doctor

```powershell
node --experimental-strip-types ops/mastra-agents/reviewer/src/mastra/verify-machine.ts doctor |
  Set-Content -Encoding utf8 .artifacts/verify-machine/<run-id>/doctor.json
if ($LASTEXITCODE -ne 0) { throw 'verify-machine Doctor failed' }
```

Doctor parses the permanent-parts file and checks every recorded install location. A missing part
fails closed. The test suite also supplies a controlled missing inventory and proves that negative
case without moving or deleting a permanent part.

## Real route proof

Any command needing the CommandCode secret must run through `scripts/julia-vault-windows.ps1` with
the restricted Julia service account. Allow at least 90 seconds for the Antigravity ACP process;
its measured cold start is about 30 seconds.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/julia-vault-windows.ps1 `
  -SecretNames COMMANDCODE_API_KEY,LINEAR_API_KEY `
  -RunArguments node,--experimental-strip-types,ops/mastra-agents/reviewer/src/mastra/verify-machine.ts,rehearsal,.artifacts/verify-machine/<run-id>/rehearsal.json
```

The rehearsal drives the real `$connections` lifecycle, `$models` list/save, and `$init JUL-225
Cancel` journey, then uses stock `AcpAgent` discovery, selection, and generation for Antigravity
and Claude, plus the documented CommandCode model list and stock `createCodingAgent()`. Its Start
payload uses JUL-208 and a prompt that forbids file reads and mutation. Retain the exact models,
per-route result and trace, timestamp, test output, candidate commit, and dirty-tree digest beside
the two JSON files.

## Cleanup

`verify-machine` disconnects only the two ACP processes it started. It does not remove machine
parts, sign-outs, package installs, configuration, or evidence.
