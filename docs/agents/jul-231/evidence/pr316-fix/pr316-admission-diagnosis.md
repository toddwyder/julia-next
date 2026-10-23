# Admission test correction

The first package failure masked 17 obsolete test failures in the next dependency owner. `node --test ops/mastra-agents/reviewer/test/card-admission-check.test.mjs` reproduced all 17 locally.

The ranked predictions were obsolete admission expectations, failed map extraction, or installed-document differences. The exact historical refused map still produced one extracted map and the schema admitted it. The PR intentionally removed `frameworkMapFindings` from `validateCardAdmission`, matching JUL-231's requirement that learning tests replace Framework Map admission. Both framework-gap and installed-file expectations failed, ruling out installed-doc differences.

The fault was keeping tests for the removed requirement. No production behavior was changed. The obsolete citation-variant admission tests were replaced by behavior checks that a complete card remains admissible despite a refused historical map, including a map on a later comments page. A negative case still rejects a card missing acceptance criteria. Existing empty-list, multi-card CLI, required-heading and legacy-heading checks remain.

The corrected admission suite passes 8 tests. The original failed suite and final output are retained in `/tmp/pr316-admission-red-confirmed.txt` and `/tmp/pr316-admission-green.txt`.

Test Behavior, Not Implementation kept checks at the existing admission API and CLI. Fix Root Causes kept the retired requirement out of production.
