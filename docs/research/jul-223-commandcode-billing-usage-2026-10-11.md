# JUL-223 CommandCode billing/usage authentication research — 2026-10-11

## Scope and source boundary

This note checks the CommandCode credential and request-cost contracts needed by
the JUL-223 cost brake. It uses CommandCode's public documentation, the current
first-party Studio web client, the installed first-party Command Code CLI, and
the documentation and public declarations bundled with the reviewer's installed
Mastra packages. No third-party account of either API is used.

## CommandCode findings

1. **A Command Code API key is documented only for the Provider API (and the
   CLI), not for Studio's internal usage-list endpoint.** The provider reference
   says to pass the key as `Authorization: Bearer <COMMANDCODE_API_KEY>` and
   enumerates the supported `/provider/v1/...` routes. It does not list a billing
   or per-request usage route, an API-key scope, or a scope-setting operation.
   The Studio guide likewise describes API keys for the Provider API and CLI.
   Sources: [Provider API endpoints](https://commandcode.ai/docs/provider#endpoints),
   [Provider API quickstart](https://commandcode.ai/docs/provider#quickstart),
   [Studio API keys](https://commandcode.ai/docs/studio#api-keys).

2. **The credential accepted by the current first-party per-request usage client
   is the signed-in Studio browser session.** The current Studio usage bundle
   requests `/internal/usage` with Fetch's `credentials: "include"` and supplies
   no bearer `Authorization` header. Its route constants also identify
   `/internal/usage/summary` and `/internal/usage/charts`. Those assets provide no
   operation for granting a Provider API key access to the internal routes.
   Sources: [Studio usage bundle](https://commandcode.ai/assets/usage-C1KUGoNk.js),
   [Studio route constants](https://commandcode.ai/assets/constants--Sqc_cVk.js).
   In the minified assets, stable inspection anchors are function `Gt` and
   `credentials:"include"` in the usage bundle and the `USAGE` object in the
   constants bundle.

3. **The official materials checked expose no way to mint or enable an API key
   for `/internal/usage`.** The public docs have no billing/usage credential or
   API-key scope section. The official clients distinguish the two credentials:
   Studio uses its signed-in session for `/internal/usage`; the CLI uses the
   Command Code API key as a bearer credential for its documented keyed routes.
   This is a negative finding bounded to the provider/studio/pricing docs,
   current Studio assets, and installed CLI source inspected here—not a claim
   about an undocumented server capability.

   The installed first-party `command-code` 1.72.3 CLI corroborates the boundary.
   Its `fetchUsageData`/`fetchUsageSummary` path supplies API-key bearer auth to
   `/alpha/whoami`, `/alpha/billing/credits`, `/alpha/billing/subscriptions`, and
   `/alpha/usage/summary`; its usage constants expose `SUMMARY` only, with no
   keyed per-request-list route. Source: installed
   `C:\Users\toddw\AppData\Roaming\npm\node_modules\command-code\package.json`
   and `C:\Users\toddw\AppData\Roaming\npm\node_modules\command-code\dist\cli.mjs`
   (anchors `fetchUsageData`, `buildCommandAuthHeaders`, and
   `/alpha/usage/summary`).

   A launcher-contained live probe on 11 Oct 2026 verified the credential already
   stored in the Julia 1Password vault. It received HTTP 200 from
   `/alpha/usage/summary` in 1,074 ms. The response exposed only aggregate fields:
   request counts, total/average cost, aggregate input/output/total tokens,
   credits, and period basis. It exposed no request ID, trace ID, or per-request
   rows. The temporary probe printed only status, latency, and field names/types;
   it was removed immediately afterward and no secret value left the launcher.
   An aggregate delta is not a safe substitute because another CommandCode call
   during the interval would be charged to the wrong reviewer call.

4. **The per-request Studio record has the necessary join and cost fields.** The
   usage client renders each record's request `id`, creation time, token counts,
   `meta.totalCost` (with input/output/cache cost components as available), and
   `meta.traceId`. The Provider API response docs, by contrast, document token
   usage but not a cost field. Sources:
   [Studio usage bundle](https://commandcode.ai/assets/usage-C1KUGoNk.js)
   (anchors `Jn`, `ja`, and `Ca`),
   [Provider API support](https://commandcode.ai/docs/provider#api-support),
   [Studio usage details](https://commandcode.ai/docs/studio#usage-details).

5. **CommandCode describes usage visibility as real-time, but gives no polling
   latency guarantee.** The Studio and pricing/limits pages say that request
   history tracks usage as it happens. Neither specifies an SLA for when an
   individual record becomes queryable. The Studio client's five-minute cache
   freshness setting is a UI cache policy, not evidence of backend delay.
   Consequently a live request-ID poll is required before concluding that
   `/internal/usage` is timely enough to gate the next paid model call.
   Sources: [Studio usage tab](https://commandcode.ai/docs/studio#usage-tab),
   [Tracking your limits](https://commandcode.ai/docs/resources/pricing-limits#tracking-your-limits),
   [Studio usage bundle](https://commandcode.ai/assets/usage-C1KUGoNk.js).

## Mastra stock path for externally reported cost

The installed versions are `@mastra/core` 1.75.0 and
`@mastra/observability` 1.18.4. Their stock, user-facing metric API is
`MetricsContext.emit(name, value, labels, { costContext })`; `costContext`
accepts `provider`, `model`, `estimatedCost`, `costUnit`, and `costMetadata`.
An observability instance exposes `getMetricsContext(span?)`, so an exact
CommandCode charge can be emitted as a normal trace-correlated Mastra metric.
Sources: bundled
[`metrics.d.ts`](../../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/observability/types/metrics.d.ts)
and [`base.d.ts`](../../ops/mastra-agents/reviewer/node_modules/@mastra/observability/dist/instances/base.d.ts).

`TokenCostControl` then uses the stock observability storage
`getMetricAggregate` query before each model call. Its bundled reference warns
that exporters persist metrics asynchronously, making the built-in threshold
approximate for fast loops. The application therefore still needs to await the
request-ID billing lookup and ensure the exact-cost metric has flushed before
allowing the next paid call; the external lookup/poll is custom because the
installed Mastra packages contain no CommandCode billing adapter. Once obtained,
however, the cost enters the brake through Mastra's stock metric context rather
than through a custom storage adapter. Source: bundled
[`TokenCostControl` reference](../../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-processors-token-cost-control.md).

The bundled documentation was searched for `metrics.emit`, external/provider
cost injection, and CommandCode integration. It documents the guard's reads but
has no prose page for supplying third-party billed cost. The public type
declarations above are the installed package's explicit supported surface for
that job.
