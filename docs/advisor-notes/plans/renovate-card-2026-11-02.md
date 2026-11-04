# Weekly grouped dependency PR (Renovate), npm packages

## Goal
The repository holds a Renovate setup that, once the Renovate GitHub app is installed, opens one pull request a week with the minor and patch updates for every npm package file in the repo. Each major update and each security fix gets its own pull request. The existing checks decide whether a pull request is good.

## Steps
1. Add `renovate.json` at the repo root. It covers every `package.json` in the repo, groups minor and patch updates into one weekly pull request, keeps each major in its own pull request, and opens security fixes immediately. Every Renovate pull request body carries a lone `No card: dependency update` line, the form `check-branch-pr` accepts for work that is not a card.
2. Add a test beside the other `.test.mjs` files that reads `renovate.json`, builds the pull request body Renovate will write, and runs it through the same card check `check-branch-pr` uses. The test fails when that body would be rejected.
3. Add the Renovate config validator, with its version pinned, as a step in the `repository-hygiene` job of `.github/workflows/ci.yml`. Add a row for it to the Enforced rules table in `AGENTS.md`.
4. In the PR, say that the Renovate GitHub app must be installed on the repo by the account owner after this merges, and that installing it is the only step left.

## Acceptance criteria
- A broken Renovate setup is caught by the repository's checks before it reaches main.
- A Renovate pull request body always satisfies the repository's card check.
- The Renovate setup covers every place the repository declares the libraries it uses.
- Minor and patch updates are set to arrive together in one weekly pull request, and each major update and each security fix is set to arrive separately.

## Outside check
The Shipping reviewer reads `renovate.json` and confirms it groups as the goal describes, with majors and security fixes separate.

## Out of scope
Installing the GitHub app, auto-merge, Mastra, pstack (it already has `check-pstack-pin`), server software, and the Firebase advisory fix.

## Pull request
Name only this card in the pull request title and description.
