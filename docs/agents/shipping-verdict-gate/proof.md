# Shipping verdict gate: proof

Branch `feat/shipping-verdict-gate`, 30 October 2026. Nothing here needs a card to build: the
work is Todd's own correction, delivered as its own pull request.

## What the gate does

`scripts/check-shipping-verdict.mjs` refuses a card pull request until a comment on the pull request
holds a shipping verdict for the pull request's current head, naming the builder and a different
verifier, with a PASS for every criterion it lists. `scripts/check-shipping-verdict.test.mjs` covers
the rules, and the `shipping-verdict` job in `.github/workflows/ci.yml` runs the script in CI, where
the `checks` job requires it to pass.

## Unit tests

```text
$ node --test scripts/check-shipping-verdict.test.mjs
ℹ tests 31
ℹ pass 31
ℹ fail 0
```

The gate's decisions are unit tests over the pure functions. The CLI is run once, on a real event
that carries no pull request, which shows the exit code and the printed line without any stand-in
for GitHub. An earlier version of the test file served shaped GitHub responses from a local server,
and `scripts/no-fakes-repository.test.mjs` refused it, which is the rule working: a test may not
stand in for an outside service. It is also why this file proves the red and green states on real
pull requests instead.

The tests cover: a pull request naming no card, a body that merely mentions another card, a `Card:`
line, a `runner/card-<n>` branch, a paper branch, the title deciding over the branch, no verdict, a
verdict on an older head, a PASS then a push, a PASS on the head, an uppercase head, a FAIL with the
criteria named, a PASS with no criteria, a PASS with one criterion failed, a missing note, a missing
builder, a missing verifier, a verifier that is its builder, another card's verdict, an unknown
verdict word, a title naming two cards, only a fenced json block counting, prose PASS ignored, the
printed template parsing once filled, the pull request number from the flag, the event and the ref,
and the CLI's exit code on a push event.

## Real pull requests, read-only

Run with `GITHUB_TOKEN` from `gh auth token` against `toddwyder/julia-next`:

```text
#383 exit=1 MISSING: no shipping verdict covers head f05346549b7d9034417e9c97068cf0ed0c2f4324 of JUL-290
#373 exit=1 MISSING: no shipping verdict covers head da46e69717a5468b97ddecd815b294043303c42a of JUL-276
#371 exit=0 PASS: this pull request names no card
#375 exit=0 PASS: this pull request names no card
#374 exit=0 PASS: this pull request names no card
```

#383 and #373 are card pull requests with no verdict, so the gate is red on them now, which is the
state Todd asked for. #371 is the JUL-276 plan, and a plan cannot satisfy the card's criteria, so
the gate leaves it alone.

## Red and green on one pull request

<https://github.com/toddwyder/julia-next/pull/384> was a throwaway harness (closed, branch deleted)
that carried the gate script on a branch cut from `main`. Each step ran
`node scripts/check-shipping-verdict.mjs --pull 384`:

| Step | What happened | Exit |
| --- | --- | --- |
| 1 | opened with no verdict | 1 |
| 2 | PASS verdict for head `301d604` | 0 |
| 3 | pushed a commit, head moved to `58bd5fe` | 1 |
| 4 | FAIL verdict for `58bd5fe` | 1 |
| 5 | later PASS for the same head `58bd5fe` | 0 |
| 6 | a PASS whose verifier was its own builder | 1 |

Step 3 is the point of the gate: the PASS from step 2 stayed on the pull request and the gate still
went red, because it read the head again. Step 6 shows the declared identity rule refusing a model
that verifies its own code.

## Not proven here

- CI itself has not run the new job yet. The push is refused: the signed-in token is a fine-grained
  token without the Workflows permission, and GitHub refuses any push that changes
  `.github/workflows/ci.yml` without it. The gate's own decision is proven above; the job wiring
  waits on that permission.
- The first real PASS arrives from the first card build that runs a verifier. Until then card pull
  requests stay red, which is the intended state.
