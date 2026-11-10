# Rationale: Worst-Case Simultaneous Reservation and Bounded Output

## Problem

A build slice running under budget caps leaked tokens and dollars on real model calls. Three distinct defects caused the leak:
1. `options.inputTokens` was read from a field never sent by the AI SDK call interface, evaluating to zero and underestimating prompt size.
2. No output limit was passed to provider calls, allowing models to generate unbounded output tokens.
3. Concurrent model calls were not reserved against shared caps, so multiple simultaneous calls could be admitted together and cross the ceiling before any usage was recorded.

The solution must make caps hard ceilings on real model calls, support concurrent calls without overcommitting shared budgets, and guarantee that total reserved plus settled spend never exceeds the cap.

## Usage (caller's view)

A caller configures a slice with dollar and token caps, wraps the provider model, and invokes streaming or generation:

```javascript
import { createSliceControl } from './machine/budget/control.mjs';
import { agentModel } from './machine/flow/role-models.mjs';

const control = createSliceControl({
  directory: './.artifacts/flow/budget',
  dollarCap: 4,
  tokenCap: 2000000,
});

control.assertStart();

const rawModel = agentModel('openai/gpt-6-luna');
const wrappedModel = control.wrapModel(rawModel, { id: 'openai/gpt-6-luna', role: 'observer' });

// Single or concurrent calls reserve worst-case tokens and dollars upfront
const stream = await wrappedModel.doStream({
  inputFormat: 'messages',
  mode: { type: 'regular' },
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'Analyze build logs.' }] }],
});
```

When prompt input exceeds remaining room or no room exists for minimum output, the call is refused with `no_room_under_caps` before dispatching to the provider.

## Shape

The architecture uses a multi-reservation tracker per slice control instance:

```typescript
interface Reservation {
  id: string;
  model: string;
  role: string;
  modelId: string;
  provider: string;
  startedAt: string;
  inputTokens: number;
  maxOutputTokens: number;
  worstTokens: number;
  worstDollars: number;
  finished?: boolean;
}

interface SliceRecord {
  phase: 'idle' | 'calling' | 'stopped' | 'finished';
  totals: { tokens: number; dollars: number };
  reservations: Reservation[];
  calls: CompletedCall[];
  stop?: StopInfo;
}
```

1. **Input Token Estimation:** `estimateInputTokens(options)` computes byte length of serialized prompt and message structures in UTF-8, providing a safe upper bound on input tokens.
2. **Worst-Case Reservation:** `begin()` calculates held reservations `reserved()`, computes remaining room under both token and dollar caps, determines the largest allowable output `maxOutputTokens`, and stores an active reservation in `record.reservations`.
3. **Provider Bounding:** `wrapModel()` transmits `maxOutputTokens`, `maxTokens`, and `providerOptions.openai.maxCompletionTokens` to ensure provider enforcement.
4. **Span Reconciliation:** As inference spans arrive via telemetry, `recordSpan()` matches against active candidates in `record.reservations`, settles exact spend into `record.totals`, releases the matched reservation, and verifies spend did not exceed the reservation.

Decision principles applied: `principle-model-the-domain` (explicit reservation collections), `principle-boundary-discipline` (input estimation at the proxy boundary), and `principle-prove-it-works` (rerunnable script against real models).

## Synthesis decision

Adapted candidate B (multi-reservation in-memory collection with atomic disk persistence) over candidate A (lock-step single-call mutex). Candidate A serialized all asynchronous operations and blocked concurrent reflection/observation memory calls. Candidate B admits concurrent calls as long as their combined worst-case limits fit within the remaining cap, rejecting only calls that would violate the ceiling.

## Tradeoffs accepted

- We accept conservative overestimation of prompt tokens via UTF-8 byte length in exchange for zero tokenizer dependency and guaranteed ceiling bounds.
- We accept provider abort when a concurrent call fails admission in exchange for fail-closed budget safety.

## Alternatives considered

- **Single serialized call queue:** Rejected because it introduced latency bottlenecks and prevented concurrent memory reflection and tool execution.
- **Post-hoc trace enforcement only:** Rejected because real models can generate thousands of unexpected tokens before the trace arrives, causing budget leaks.

## Open questions and risks

None for JUL-360. Real model tests confirm Luna streams correctly with bounded limits and refuses oversized prompts before provider admission.

## Next implementation step

Stage the failing reproduction commit, apply the multi-reservation controller patch, and extend the formal model checker.
