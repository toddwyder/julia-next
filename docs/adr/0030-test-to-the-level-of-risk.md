---
Status: proposed. Todd decided 12 Nov 2026.
---
# Test to the level of risk

A pull request runs the checks its change can break: one that changes only documents runs the quick repository checks; anything else runs the full set, browser checks included. Why: full runs on text changes cost time and fail on things the change cannot touch.
