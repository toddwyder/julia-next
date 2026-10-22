# Candidate B

## Problem

The installed SDK resolves builder, observer and reflector models internally. Wrapping the visible controller usage event misses transport retries and memory requests. Candidate B preserves all stock construction and intercepts the final HTTP dispatch inside a dedicated adapter worker. The worker installs its fetch guard before importing the SDK. Settings describe endpoint and wire protocol facts. No provider names occur in core policy code.

This is a proposed design. Installed source confirms the stock resolver is shared by main and memory routes and that createMastraCode accepts settingsPath, workspace, stock memory defaults and credential-source hooks. Complete interception of the installed transports still needs a learning test before implementation adopts this boundary.

## Usage

A caller uses the adapter without importing the SDK.

```js
import { runCard, readCard } from './ops/build-runner/index.mjs';

await runCard({ card: 'JUL-251', role: 'builder', prompt: 'Inspect the manifest' });
console.log(await readCard('JUL-251'));
// { spentUsd: '0.000000000', heldUsd: '0.000000000', pricedBlocked: false }
```

A second caller requests a different configured role.

```js
await runCard({ card: 'JUL-251', role: 'reviewer', prompt: 'Review the manifest' });
```

A role/model switch edits public settings. The worker reads fresh settings at job start. A request record snapshots price and bounds, so later settings edits never rewrite prior cost.

```json
{
  "roles": { "builder": "routeA/modelA", "reviewer": "routeA/modelB" },
  "models": {
    "routeA/modelA": {
      "protocol": "chat-completions",
      "wireModel": "modelA",
      "endpoint": "https://example.invalid/v1/chat/completions",
      "contextTokens": 32768,
      "maxOutputTokens": 2048,
      "price": { "inputPerMillionUsd": "0", "outputPerMillionUsd": "0" }
    }
  }
}
```

Credentials never appear in this settings file. A private worker resolves them through SDK CredentialStore and CustomProvidersSource. Builder execution runs with an allowlisted environment, separate home and uid, and no read permission on the worker credential directory. The runtime supplies a custom SDK workspace sandbox that uses this launcher for every command, including nested shells. Todd's accepted administrator risk remains accepted.

## Shape

The internal shape is a durable request state machine, per Model the Domain. The request boundary validates wire data, per Boundary Discipline. The shared card total is a real invariant and uses SQLite transactions, per Separate Before Serializing Shared State. Repeated settlement is idempotent, per Make Operations Idempotent.

```ts
type CardId = string & { readonly cardId: unique symbol };
type RequestId = string & { readonly requestId: unique symbol };
type NanoUsd = bigint & { readonly nanoUsd: unique symbol };
type Price = Readonly<{ input: NanoUsd; output: NanoUsd; cacheRead?: NanoUsd; cacheWrite?: NanoUsd }>;
type TokenUsage = Readonly<{ input: number; output: number; cacheRead: number; cacheWrite: number }>;
type Reservation = Readonly<{ id: RequestId; card: CardId; maxCharge: NanoUsd; price: Price }>;
type RequestState =
  | { kind: 'reserved'; reservation: Reservation }
  | { kind: 'settled'; reservation: Reservation; usage: TokenUsage; charge: NanoUsd }
  | { kind: 'unknown'; reservation: Reservation; reason: string }
  | { kind: 'free'; reservation: Reservation; usage?: TokenUsage };

export async function runCard(input: { card: string; role: string; prompt: string }): Promise<CardResult> {
  throw new Error('not implemented');
}
export async function readCard(card: string): Promise<CardAccount> {
  throw new Error('not implemented');
}

// Private to transport module.
async function guardedFetch(request: Request): Promise<Response> {
  throw new Error('not implemented');
}
function inspectDispatch(request: Request, settings: ValidatedSettings): DispatchPlan {
  throw new Error('not implemented');
}
function maximumCharge(plan: DispatchPlan): NanoUsd {
  throw new Error('not implemented');
}

// Private to ledger module. BEGIN IMMEDIATE owns the shared invariant.
function reserve(card: CardId, plan: DispatchPlan): Reservation {
  throw new Error('not implemented');
}
function settle(reservation: Reservation, usage: TokenUsage): void {
  throw new Error('not implemented');
}
function markUnknown(reservation: Reservation, reason: string): void {
  throw new Error('not implemented');
}
```

The public API hides worker lifecycle, SDK session state, stock credential routing, all HTTP parsing and budget settlement. It exposes only card, role, prompt and result. Callers never coordinate reservations or settlements.

### Module map

- `ops/build-runner/index.mjs` validates caller input and owns IPC with the worker.
- `ops/build-runner/worker.mjs` is the sole production SDK importer. It installs guarded fetch before dynamic import, registers stock credential/runtime provider hooks and constructs stock Auto memory with the default local store. It does not set observation/reflection thresholds or buffering. It supplies the isolated command workspace.
- `ops/build-runner/transport.mjs` owns protocol parsing, model identification, output-limit enforcement and the final dispatch gate. It imports no SDK.
- `ops/build-runner/ledger.mjs` owns the SQLite schema and all card/request mutations. No caller writes its database directly.
- `ops/build-runner/settings.json` owns role mapping, model prices, documented context bounds and protocol selection. SDK native custom-provider settings may be derived from this one file. No second provider list is maintained.
- `scripts/verify-jul-251.mjs` drives the real adapter against a local HTTP fixture plus the free live provider. It records endpoint arrival counts, ledger readbacks and guard mutation outcomes.

### Dispatch and durable cost

Each actual fetch attempt creates a fresh reservation. SDK transport retries therefore create separate records. Memory calls traverse the same worker fetch. Unknown URLs cannot silently become inference calls. Allowlisted authentication/catalog routes have separate classifications and cannot carry an inference body. Redirects for model dispatch use manual handling and require reclassification before following.

Reserve before invoking native fetch. The transaction checks `settled + all unresolved reservations + new reservation <= 1_000_000_000 nanoUSD`. The card has a persisted ceiling, and reopening with different settings cannot raise it. An additional persisted trial ceiling is zero. Paid requests therefore remain disabled throughout the trial, independently of the built $1 behavior.

A free model creates a durable zero reservation and completes with or without usage. An unknown paid request blocks further priced requests on that card. Free requests remain permitted. A restart keeps unresolved reservations; it never expires them by elapsed time. The adapter may reconcile only from trustworthy usage evidence. Duplicate settlement of the same request is a no-op when identical and an error when contradictory.

The reservation uses published context capacity as the conservative upper input bound and an enforced output limit as the upper output bound. The context capacity must be a provider-enforced bound for the exact configured model and endpoint. The protocol parser overwrites every applicable output-limit field and rejects conflicting limits. It rejects unsupported modalities and unbounded protocols for paid requests. Cache categories reserve at the highest applicable configured rate unless the provider supplies a tighter independently guaranteed bound. Prices are decimal strings parsed into integer fixed-point arithmetic with upward rounding.

This conservative reservation can refuse a valid cheap request whose entire context capacity would exceed the remaining budget. That is an intentional safety/usability tradeoff. Token estimation alone cannot justify a hard dollar ceiling. Byte counts cannot universally bound multimodal or server-added input tokens. A paid model without documented enforceable limits must be refused before dispatch.

The worker buffers the inference response through completion, extracts usage and settles before releasing the response to SDK consumers. This preserves retries as separate requests and prevents tools consuming a successful priced result whose usage is missing. Missing or partial paid usage, malformed streaming completion, transport uncertainty, and abort after dispatch all persist `unknown`. A free response passes unchanged. Failed HTTP status is not evidence of zero billable usage. Zero settlement requires a protocol/provider guarantee or reported zero usage.

Stock controller usage is retained as diagnostic evidence, not the ledger source. Wire parsing is limited to generic protocol shapes. Settings select chat-completions, Responses or messages format and generic JSON/SSE selectors where needed. This costs duplicate usage normalization and is Candidate B's chief weakness. The package's stock provider normalization would be preferable if an empirically complete per-attempt hook can be exposed without replacing routing or memory.

### Acceptance nuance

A priced request's missing response usage cannot be discovered before sending that same request. The honest proof sends to a local fixture, observes missing usage, refuses its result and proves zero later priced dispatches. A separate preexisting unknown ledger entry proves refusal before dispatch. The card's phrase 'with nothing sent' cannot literally apply to discovering missing usage on the first request.

## Synthesis decision

Candidate B proposes a transport guard as the base. Synthesis belongs to the parent after comparing the other independent candidate.

## Tradeoffs accepted

- We accept buffering and delayed SDK response delivery in exchange for settlement before consumers act on a priced result.
- We accept conservative false refusals in exchange for a hard pre-dispatch bound.
- We accept protocol-level usage parsing in exchange for visibility into retries and hidden stock memory calls.
- We accept outstanding holds after crashes in exchange for never converting uncertain paid work into free capacity.

## Alternatives considered

Wrapping only SDK controller events hides stock usage normalization but exposes retry/memory accounting gaps to the caller. It cannot enforce pre-dispatch spending.

An adapter-owned model gateway can wrap V3 doGenerate/doStream and use stock normalized usage. It has a deeper useful interface when every SDK path can receive it. The installed createMastraCode configuration does not visibly expose a universal resolver override. Rebuilding memory and controller routing to inject it would spread stock responsibilities into the adapter. Prove that hook exists before preferring that design.

An external HTTP proxy observes retries and owns credentials, but introduces endpoint rewrites and subscription transport compatibility. Stock fetch interception keeps routing decisions inside Mastra and requires fewer integration seams.

## Open questions and risks

Can the installed providers capture or bypass global fetch before worker initialization? A learning test must observe builder, observer, reflector and forced transport retry requests through one guard. Failure scraps this design.

Does the stock sandbox extension let the worker launch every builder command under the isolated uid? A command and nested-command credential probe must settle this empirically.

Do exact configured providers enforce the documented context and output bounds, including reasoning and cache-write categories? Paid dispatch stays refused unless the evidence establishes this bound. The free live proof does not establish paid-provider bounds.

## Next implementation step

Build a local fixture learning test that installs the fetch guard before SDK import and proves interception of main requests, transport retries and stock observational-memory requests without changing stock routing.
