# Tell Todd about trouble within a minute, held diagnosis

From the saved output only. No Studio run.

## Refused model

- What failed: the 00:01 run with `commandcode/nope/no-such-model-1` recorded zero notices and posted zero, where one was expected. The 23:44 attempt died before the Studio answered on port 42549.
- Root cause: the stub loaded with an empty fault, so the unknown model reached the real provider, the saved output shows three provider requests and no notice, and the refusal never reached a notice.
- Fix: inject the refused model in the stub and assert one notice from `processAPIError`, with a unit case. Keep the 23:44 boot failure in the lane readiness check, not the notice code.

## 429 recovers

- What failed: the lane never started the card. `runStart` was 23:46:29.407 and `fetch failed` came at 23:46:29.414, while the stub showed the 429 and then the 200 recovery.
- Root cause: the start request to the Studio failed at the run boundary; the Studio logged ready but did not serve the start, so the injected 429 never reached a model call.
- Fix: wait for the run-start route and retry the start, fail the lane when the Studio dies, and rerun the recovery. This is the lane, not the notice code.
