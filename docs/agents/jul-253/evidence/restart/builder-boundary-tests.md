# Builder-boundary validation

## Focused result

`node --test ops/build-runner/test/pstack-session.test.mjs ops/build-runner/test/machine-settings.test.mjs` passed 9 tests with zero failures after the repair. `git diff --check` also passed.

The regression was independently run against pre-repair commit `ab6e94a0464888118796083f9ec1302b65626e53`; the new boundary assertion failed while the other six pstack-session tests passed. The exact red/green transcript is retained in `builder-boundary-red-green.txt`.

## Windows broad-suite result

The complete `ops/build-runner/test/*.test.mjs` set ran after `npm ci`: 78 tests, 71 passed, and 7 failed. The seven failures are platform or environment constraints outside the changed session-construction code: Windows access denial in adapter credential isolation, unavailable filesystem boundary enforcement, an `EBUSY` SQLite cleanup, Windows path handling in builder-home replacement, CRLF-sensitive server-main output, a GitHub fixture returning 404, and absent `systemctl` on Windows.

The changed pstack-session tests passed in that broad run. Exact-head Linux CI is the authoritative broad validation for the published repair.
