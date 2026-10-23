# Candidate A. Normalized model boundary

## Problem

The desired request accounting boundary is each public language model's `doStream` and `doGenerate`. This catches usage before the controller loses missing fields and catches each framework retry separately. Installed SDK 1.14.0 prevents installing that boundary across every stock role from a single gateway registration. This candidate is rejected for the full factory path unless the SDK gains a public model decorator hook.

## Usage

The intended caller would use one adapter API.

```js
const runner = await openCardRunner({ card: 'JUL-251', settingsPath });
await runner.run({ role: 'build', prompt });
const receipt = await runner.total();
```

A priced model without a known price fails before resolving credentials or dispatching. Each invocation reserves a conservative upper bound before calling its stock model. The returned stream forwards every chunk, but success is withheld until reported usage commits. Missing priced usage changes the card to blocked. A free model completes with or without usage and adds exactly zero.

## Shape

The data shape should use durable attempt states.

```ts
type AttemptState =
  | { kind: 'reserved'; maximumNanoDollars: bigint }
  | { kind: 'settled'; chargedNanoDollars: bigint; input: bigint; output: bigint }
  | { kind: 'unknown'; maximumNanoDollars: bigint; reason: string };
type Price =
  | { kind: 'free' }
  | { kind: 'priced'; inputPerMillion: bigint; outputPerMillion: bigint };
interface CardRunner {
  run(input: { role: string; prompt: string }): Promise<RunReceipt>;
  total(): Promise<CardReceipt>;
}
```

`adapter.mjs` would be the only production SDK importer. `budget.mjs` would own the SQLite transaction and integer arithmetic. `model-boundary.mjs` would own language model protocol versions, final usage validation and stream completion. `builder-sandbox.mjs` would own env and filesystem visibility. Settings contain role mappings and prices, never credentials.

Use one shared SQLite ledger. Budget is intrinsically shared, so transaction serialization is justified. The reserve transaction checks settled cost plus every outstanding reservation against $1. Unknown paid attempts survive restart and block paid work. Free calls remain permitted. Never release a crashed or aborted reservation automatically. The system cannot prove no charge after dispatch failure.

Before paid dispatch, a model boundary needs an authoritative maximum billed input and a provider-enforced maximum billed output. A guessed tokenizer or byte length is insufficient for tools, hidden templates, images and remote files. A safe generic policy reserves the configured full model input context at the highest applicable input/cache price plus enforced output maximum at the highest applicable output/reasoning price. Refuse unsupported media or absent hard bounds. Settings document rate source and context bound. Usage beyond a reservation is an invariant failure, and must block the card. It cannot retroactively preserve a ceiling, so the preflight assumptions need real evidence.

Model the Domain shaped the reserved/settled/unknown union. Boundary Discipline puts protocol parsing in the adapter and pure money arithmetic in the ledger. Type System Discipline keeps runtime protocol parsing outside the typed budget core.

## Evidence against the gateway implementation

1. `@mastra/code-sdk/dist/index.js:684` installs its module-local `getDynamicModel`. Its `dist/agents/model.js:213` calls module-local `resolveModel` directly.
2. `dist/agents/model.js:149-169` constructs a fresh MastraCodeGateway and invokes `resolveLanguageModel` directly for API and OAuth paths. A custom gateway mounted on Mastra is bypassed.
3. `dist/agents/memory.js:162` and role resolution around lines 65-91 directly call that same resolver. Stock observation, reflection and title generation bypass a mounted wrapper too.
4. `@mastra/core/dist/llm-DtX483Xc.js:8210-8230` constructs each router GatewayManager from constructor custom gateways and defaults. The SDK's fallback ModelRouterLanguageModel does not pass host custom gateways. Registering a host gateway does not repair this path.
5. A settings-only `julia/provider/model` alias also changes stock Auto selection. `@mastra/memory/dist/src-CTyZJ6A-.js:26524` selects Auto defaults from the first provider segment, except its special stock `mastra/` prefix. Inventing a prefix silently changes Auto semantics.
6. `Agent.model` is a public property in `@mastra/core/dist/agent/agent.d.ts:174`, so replacing that property can cover the main agent. It does not cover module-local memory, subagent and goal judge resolution. It is not sufficient evidence for complete accounting.

No requests or repository edits were made for this design.

## Synthesis decision

Reject this as the base for an unmodified full SDK factory. Graft the durable attempt state and strict usage settlement into a lower transport boundary candidate. Use normalized-model accounting only if the caller owns construction of every stock Agent, memory role and subagent through documented configuration, or a later SDK exposes the missing decorator hook.

## Tradeoffs accepted

A conservative full-context reservation rejects affordable requests in exchange for refusing calls whose upper bound is not established. An unknown charged attempt requires explicit reconciliation in exchange for never silently reusing uncertain funds.

## Alternatives considered

A gateway decorator is smaller but misses direct OAuth/API resolution. Public Agent.model replacement covers the main agent but exposes separate memory and subagent wiring to the maintainer. A transport boundary is less elegant and requires protocol adapters, but reaches stock internally constructed models without patching private modules.

## Open questions and risks

Can the transport candidate prove an input/output cost upper bound before every supported dispatch, including retries and nonstream generation? Can it distinguish credential refresh and catalog traffic from chargeable inference without placing provider names in the core? These are prototype checks, not questions for Todd.

## Next implementation step

Build a no-network learning check demonstrating that one host gateway misses the SDK's direct model resolution, then implement the complete transport boundary.
