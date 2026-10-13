# 0017. Reviewer records after the 12 October reset

Date: 2026-10-12

Status: Accepted (Todd, in conversation, 12 Oct 2026). Supersedes ADR 0011.

## Decision

1. No trace database. Each run's provider-boundary model log, kept in that run's folder, replaces stored traces.
2. No reviewer memory for now: no message history, working memory or semantic recall. It returns only after two clean live reviews on separate real changes and a third review shows a required decision that cannot be made from the card, the candidate, the test evidence and the standing rules.
3. Keep one permanent, human-readable summary line per run: card, change, round, verdict or stop and its reason, reviewer model and effort, input and output tokens, priced cost estimate, and start and end time.

## Why

The trace database exhausted laptop memory and disk. The memory stores added little to an independent reviewer without a track record. The summary line is Todd's record of what each run did, and it is cheap to keep.
