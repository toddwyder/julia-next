# JUL-251 framework grounding

## Overview

The installed reference package is `@mastra/code-sdk@1.14.0` under `/home/ubuntu/julia-jul-231/ops/build-runner`. Its lockfile pins core 1.78.0, OpenAI 3.0.131 and OpenAI-compatible 2.0.87. Production adapter installation must live in this branch's `ops/build-runner` with its own committed lockfile. Existing `framework/@mastra/code-sdk/framework-runtime.mjs` and `real-route.mjs` verify both SDK version and lockfile identity and accept `FRAMEWORK_RUNNER_ROOT` for the existing installation.

## How it works

`bootLocalAgentController` creates the stock controller, local storage, workspace and dynamic memory. `runMC` drives it. Normal model calls and observer/reflector memory both resolve through `dist/agents/model.js` `resolveModelForRequest`. That function obtains custom providers from the runtime source or settings, obtains a stock CredentialStore, creates MastraCodeGateway and resolves the model. `dist/agents/memory.js` calls this same resolver for memory with the system prompt-cache scope.

The public `MastraCodeGatewayOptions` has no fetch override. Its custom-provider branch creates OpenAI-compatible with only provider name, base URL, key and headers. The AI provider-utils request helpers acquire `globalThis.fetch` when dispatching. The stock OpenAI Codex OAuth fetch rewrites URLs, injects auth and then calls the process global fetch. A process-owned fetch interceptor therefore sees actual HTTP requests from both stock provider routes and memory, including each SDK retry. It leaves stock model routing intact. Existing learning tests already use this seam. Source evidence is SDK `dist/agents/mastracode-gateway.js:289-305`, `dist/providers/openai-codex.js:137-175`, provider-utils `dist/index.js:851-861,1290-1344`.

A lower fetch seam cannot recover a full canonical model ID from the bare wire model unambiguously. Settings must associate approved endpoint and wire model with the selected canonical model and its price. Each intercepted dispatch must reserve in the shared durable ledger before calling the original fetch. Each response settles once using actual reported tokens. Controller `usage_update` cannot enforce admission because it arrives after dispatch and successful step completion. It also misses failed retry attempts and can emit nothing when usage is absent.

The stock custom-provider streaming body does not request usage. `usage-request.test.mjs` proves that by inspecting its actual request before network. To settle priced compatible streams, the interceptor needs protocol-aware wire normalization such as `stream_options.include_usage=true`, and robust usage extraction. Refusing missing usage remains mandatory even after requesting it. OpenAI chat, OpenAI Responses and Anthropic have different wire forms. A model-neutral core can dispatch through protocol functions selected by settings; that is distinct from branching on provider or model names. Unsupported protocols should fail before inference rather than bypass accounting.

Default memory is already the requested stock implementation. It sets observational memory enabled unless `MASTRACODE_DISABLE_OBSERVATIONAL_MEMORY=1`, defaults to 30000 observation and 40000 reflection thresholds, thread buffering 1/5 and buffer activation 2000, and stock Auto resolution. Do not copy the old runner's `runtime.mjs`, which explicitly disables observational memory and title generation. Do not inject custom Memory or change thresholds to make proof easier. Source is `dist/agents/memory.js:180-247`. Stock Auto may select a different memory model from a custom free main model, so every resulting endpoint/model still needs a priced setting or admission must refuse it. This is a concrete free-proof risk to inspect before inference.

## Credential seam

Stock `setCredentialStoreProvider` and `setCustomProvidersSource` let the adapter retain secrets outside builder settings. Registering a CredentialStore suppresses bootstrap API-key export to the environment. `allowEnvironmentFallback=false` prevents inherited credential fallback. The stock AuthStorage file is plaintext mode 0600 and contains OAuth access/refresh tokens, so sharing its path or HOME with a same-user builder does not provide functional isolation. A separate builder identity, sanitized environment and builder filesystem permissions must cover nested commands. The original runner only rejects apikey slots; that is neither model neutral nor sufficient isolation.

Credential source evidence is SDK `dist/auth/storage.js`, `dist/agents/credential-resolver.d.ts`, `dist/agents/custom-provider-source.d.ts`, `dist/index.js:250-280`, plus `credentials.test.mjs`. Authentication refresh calls also pass through fetch but are not inference and must not be parsed as model requests. Fail closed for inference destinations without a settings association.

## Existing proof

`native.test.mjs` exercises real local memory persistence, real settings, thread/model ordering, local model-override refusal and enabled OM construction without inference. Thread creation resets selection; choose the model after creating the thread. Passing `runMC.model` with the canonical custom model is rejected as unknown in the current learning test; use session model selection instead.

`credentials.test.mjs` checks real auth-file persistence/mode and runtime custom-provider resolution using synthetic credentials. `usage-request.test.mjs` inspects a stock-built streaming request and stops before network. Tool hooks and workspace tests in the same folder cover command guard facts, not card request accounting. `scripts/commandcode-requests.mjs` is a previous card's provider-specific tracker and is not suitable as the new neutral core. It hardcodes JUL-250/model admission, accepts a CommandCode endpoint only and has an implicit initial ledger schema.

No model request was made for this grounding.

Auto-memory follow-up resolved the free-proof risk. `@mastra/memory/dist/src-CTyZJ6A-.js:26524` returns the main model unchanged for unknown/custom provider IDs. `resolveAutoOMModelId` preserves the custom canonical main ID when that result is unchanged. Thus a `commandcode-free/reflection/beam:free` main model also serves stock Auto memory without changing the Auto implementation. Remove inherited `GOOGLE_GENERATIVE_AI_API_KEY` from the trusted runtime too, because stock Auto gives that environment key priority and picks Google when it exists. Known stock providers choose smaller models, including `openai/gpt-6-luna` for OpenAI and OpenAI Codex.

The read-only run passed all 8 selected framework tests with no model request. Command was `FRAMEWORK_RUNNER_ROOT=/home/ubuntu/julia-jul-231/ops/build-runner node --test framework/@mastra/code-sdk/usage-request.test.mjs framework/@mastra/code-sdk/credentials.test.mjs framework/@mastra/code-sdk/native.test.mjs`.
