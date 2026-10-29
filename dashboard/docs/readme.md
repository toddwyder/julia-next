# Run the Ready dashboard

This separate Next 16.3.5 app reads Julia-next Ready cards from Linear on every request. It never starts a build or changes a card.

1. Run `npm ci` in `dashboard/`.
2. Run `npm run build` in `dashboard/`.
3. From the repository root, run `node scripts/julia-agents.mjs -- env DASHBOARD_HOST=<tailnet-address> npm --prefix dashboard start`.
4. Open port 4313 on that tailnet address. Do not expose the dashboard on the public internet. Tailscale is the access boundary.

No service is installed by PR-1. No production deployment is authorized. The service belongs to PR-2.

## Read commands

From the repository root, run `node scripts/julia-agents.mjs -- node scripts/linear-cli.mjs list-ready`.

The read-only command follows every Linear page, validates the provider response, and returns title, identifier, id, and createdAt, newest first. It does not cache. Missing keys, malformed responses, and network failures are errors rather than empty lists.

## Tests

Run `npm test`, `npm run lint`, and `npm run build` in this folder. The repository discovers this folder as its own locked test owner without a registry change.

`npm run test:browser` launches a local no-key server and tests the real configuration-failure path on phone and desktop. It does not contact Linear or invent cards.

For real list, Start, and Back proof, launch the built candidate separately with the vault wrapper. Set `DASHBOARD_URL` to that candidate and run the browser tests through the wrapper so both the browser assertions and server read real Linear. The spec compares the rendered list with fresh real reads and checks that navigation leaves the cards Ready. Do not run card mutations without a coordinator reservation.

## Design and records

The approved design is `origin/pilot/dashboard-d2` at `19f3a31`, under `docs/pilot/dashboard-d2/approved/`. Picture 12 specifies mint #10B981, iris #6366F1, amber #F59E0B, slate #64748B, light mode, and Public Sans. Picture 08 describes the later Start controls, not part of PR-1. Decision 0008 excludes the invented outer navigation.

The 22 decision files and glossary are real Linear exports. Each file records its source URL, Linear update time, and export time. The older snapshots remain untouched outside this PR's ownership.
