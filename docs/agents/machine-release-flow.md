# Julia machine delivery continuation

Todd authorized these changes in order: release continuation (JUL-186), twice-rejected problem parking (JUL-53), then application/runner observability. Real connection checks and Todd UAT are deferred to the first Julia cards. The existing initial build plus three-repair maximum remains; a second rejection of the same problem stops earlier. This work creates no tracker issues.

## Release setup

Use the ordinary signed-in GitHub CLI and the existing Vercel Git integration, never the paused Factory publisher. The runner machine needs git, gh, Node, the checkout's locked dependencies and Playwright browser installed. GitHub `main` must enforce required checks, require an up-to-date branch, and enforce the rule for admins. The release gate refuses a changed reviewed base or missing protection. The merge request leases the reviewed head SHA, and the returned merge tree is checked against the reviewed tree.

Set `JULIA_RELEASE_CONFIG` to an operator-owned JSON file outside the builder checkout:

```json
{
  "repository": "toddwyder/julia-next",
  "projectId": "the existing Vercel project ID",
  "teamId": "the existing Vercel team ID, if applicable",
  "productionUrl": "https://the-existing-production-host",
  "uatOperator": "Todd"
}
```

Keep `VERCEL_TOKEN` in the runner environment, never in this file or a card. The configuration and exact reviewed input are frozen in `<issue>-release.json`. A completed delivery PASS resumes without running builder/reviewer again. It pushes the reviewed SHA, creates/reuses its PR, waits for the exact preview, and reports `awaiting-uat` with the URL. A building preview reports `awaiting-preview`; repeat the same `$init` to inspect it again.

Use the [Julia 1Password vault launcher](julia-secret-vault.md) to supply runtime secrets from references instead of maintaining plaintext runner environment files.

After Todd accepts that preview, set `JULIA_UAT_DECISION` to a separate operator-owned decision JSON file, then repeat the same `$init`:

```json
{
  "issueId": "JUL-123",
  "commit": "the full reviewed commit SHA",
  "previewId": "the reported Vercel preview ID",
  "previewUrl": "the reported preview URL",
  "decision": "accept",
  "decidedBy": "Todd"
}
```

Use `send-back` and a `reason` to return the candidate without merging. A different issue, SHA, preview or operator cannot authorize merge. After acceptance, the runner automatically observes production for up to ten minutes, then runs the existing home journey, checks browser errors and checks `/api/health` against the merged SHA. Failure evidence is saved in `<issue>-production-smoke.json`. Failed deployment builds are recorded too. It restores the previous serving deployment if the failed deployment still owns production; it refuses to replace an unrelated newer release. A previous deployment already serving is reported as recovered. This is a deployment rollback; it does not rewrite `main` or silently create a revert issue.

Production timeout/network interruption retains the merged SHA and an actionable saved observation result; resume the same run to continue monitoring. An interrupted external write is parked with its journal. Inspect GitHub/Vercel before repairing that journal; never delete state to obtain an automatic retry.

## Rejections and telemetry

Review FAIL findings now require nonempty string `problemId` values. Reviewers receive prior problem IDs and must reuse an ID for the same underlying defect even when descriptions or lines change. Both full rejection reasons, handoffs and commits survive restart. Different defects still consume the existing repair budget. Legacy saved findings can be classified by requirement/file/mechanism; malformed new identities are inconclusive and park.

Set `NEXT_PUBLIC_SENTRY_DSN` in the application environment. Next's `onRequestError` exports caught server errors through Sentry and awaits a bounded flush. No request headers/body are forwarded. On the first card, temporarily set `JULIA_OBSERVABILITY_PROOF_TOKEN` on the selected preview, POST `/api/observability-proof` with the exact `x-julia-proof-token` header, and verify the controlled exception in Sentry. The route returns 404 without the secret and throws only the fixed proof error when authorized. Remove the temporary environment value afterward.

Set `AXIOM_TOKEN` and `AXIOM_DATASET` on the runner. Normal delivery and release results emit `julia-next.delivery` events containing selected issue/stage/outcome/commit fields. Local telemetry receipts distinguish `unconfigured`, `failed`, and accepted ingestion; prompts, source and credentials are excluded. First-card proof should confirm the corresponding issue event in Axiom, rather than treating an HTTP receipt as dashboard visibility.

## Validation boundaries

Fixture tests exercise public delivery/release boundaries and the actual command/API adapters; application tests cover the disabled proof route and exporter behavior. They are not live provider proof. The first cards will exercise real GitHub/Vercel credentials and protection, preview access, Todd UAT, production browser checks, Sentry visibility and Axiom visibility. No live release or merge was performed while implementing this change.

Framework references: [Vercel deployments API](https://vercel.com/docs/rest-api/deployments/list-deployments), [Vercel rollback](https://vercel.com/docs/deployments/rollback-production-deployment), [GitHub pull request merge API](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request), [Next onRequestError](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation), [Sentry Node APIs](https://docs.sentry.io/platforms/javascript/guides/node/apis/), [Axiom ingestion](https://axiom.co/docs/restapi/endpoints/ingestIntoDataset).
