# 0016. Current reviewer-only boundary and deferred Mastra builder

Date: 2026-10-12

Status: Proposed

## Context

The repository currently contains Mastra reviewer components but no Mastra builder agent. The normal
review command is also disabled while the minimum reviewer route is being rebuilt and verified.

## Decision (Agent Design Choice)

1. **Reviewer only:** `ops/mastra-agents/reviewer` contains the current Mastra component work. Its Git
   tools use `git diff` and `git show` to read the pinned candidate without writing repository files.
2. **Disabled normal route:** `runReviewer` refuses normal execution. The separately opted-in provider
   probe is the only current path that can make paid reviewer calls.
3. **No Mastra builder:** There is no implemented Mastra builder role. Builder research, implementation,
   and integration with the reviewer remain future work.
4. **No integrated two-agent route:** The current package does not yet enforce builder/reviewer provider
   separation or provide the planned delivery-runner orchestration.

## Consequences

- The current code supplies reviewer components and offline or explicitly opted-in probe seams only.
- Builder/reviewer separation and delivery orchestration must not be claimed until those routes exist.
