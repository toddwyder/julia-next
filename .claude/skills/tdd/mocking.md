# When to Mock

Mock at **system boundaries** only:

- External APIs (payment, email, etc.)
- Databases (sometimes - prefer test DB)
- Time/randomness
- File system (sometimes)

Don't mock:

- Your own classes/modules
- Internal collaborators
- Anything you control

## Designing for Mockability

At system boundaries, design interfaces that are easy to mock:

**1. Use dependency injection**

Pass external dependencies in rather than creating them internally:

```typescript
// Easy to mock
function processPayment(order, paymentClient) {
  return paymentClient.charge(order.total);
}

// Hard to mock
function processPayment(order) {
  const client = new StripeClient(process.env.STRIPE_KEY);
  return client.charge(order.total);
}
```

**2. Prefer SDK-style interfaces over generic fetchers**

Create specific functions for each external operation instead of one generic function with conditional logic:

```typescript
// GOOD: Each function is independently mockable
const api = {
  getUser: (id) => fetch(`/users/${id}`),
  getOrders: (userId) => fetch(`/users/${userId}/orders`),
  createOrder: (data) => fetch('/orders', { method: 'POST', body: data }),
};

// BAD: Mocking requires conditional logic inside the mock
const api = {
  fetch: (endpoint, options) => fetch(endpoint, options),
};
```

The SDK approach means:
- Each mock returns one specific shape
- No conditional logic in test setup
- Easier to see which endpoints a test exercises
- Type safety per endpoint

## Framework learning tests

For framework learning tests, follow [JUL-249](https://linear.app/julia-next/issue/JUL-249)
and [the retained learning suite](../../../../framework/@mastra/code-sdk/). Todd's 22 October 2026
07:56 decision scopes this guidance: framework facts use direct calls through the installed
framework's public interfaces, without a model or model prompt steering a tool call. This includes
hooks, guards, local refusals, settings, memory switches and push handling. Their outcomes must not
depend on the configured model. No mocks or fake outside responses prove a seam.

Use a real model only when its side is the subject: real request resolution, a refusal reaching it
as a valid tool result without a provider error, and feedback reaching the model. Keep those tests
few and use Beam under AGENTS.md's standing free-model rule. If the model does not attempt the
expected step, record `model did not attempt` as inconclusive and rerun once. It is never a pass or
failure of the guard; an unresolved inconclusive result cannot satisfy Proof. Do not rerun a real
guard failure as though it were a missing model step. Show each rewritten test red with its guard
broken, green after restoration, then run the complete suite through op run. Headers identify the
owning-lockfile version and exact public documentation or declaration read.
