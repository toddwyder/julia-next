# JUL-251 — Narrow Shape, 22 October 2026

Research only, on `hybrid/pstack-trial`; spending $0. Installed SDK **1.14.0**, core **1.78.0**, OpenAI provider **3.0.131**, OpenAI-compatible provider **2.0.87**. The version-checked research installation is `/home/ubuntu/julia-jul-231/ops/build-runner`, not an installation of the trial core. [Preflight and lockfile identity](evidence/narrow-shape/preflight.json).

## a. Per-request token usage

**No, not unconditionally: API-key, subscription and custom-provider routes share the stock per-step usage interface when the provider supplies counts, but stock routing does not guarantee that every source reports them.**

The common controller event is `usage_update`, with `usage.promptTokens`, `completionTokens`, `totalTokens`, and optional `reasoningTokens`, `cachedInputTokens`, `cacheCreationInputTokens`, `cacheCreationInputTokens5m`, `cacheCreationInputTokens1h`, `raw`. It is emitted from each `step-finish`, not only at the end of a card. The stream/step interface names the first two fields `inputTokens` and `outputTokens`; the headless result retains only `inputTokens`, `outputTokens`, `totalTokens` from the latest event, so that result alone is not a per-card ledger.

| Source | Provider fields and stock normalization |
| --- | --- |
| API key (installed OpenAI Responses route) | `usage.input_tokens`, `output_tokens`, `input_tokens_details.cached_tokens`, optional `cache_write_tokens`, `output_tokens_details.reasoning_tokens`; normalized to the common interface above. Other API providers have their own wire fields, with the same stock usage contract. |
| Subscription (installed ChatGPT Codex route) | Same Responses usage fields as OpenAI API-key routing, through the same installed OpenAI Responses parser; OAuth changes endpoint/authentication, not the usage contract. |
| Custom provider (stock OpenAI-compatible chat route) | `usage.prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens`; normalized to the common interface; cache-write usage is undefined in this converter. |

The underlying V3 providers expose `inputTokens.{total,noCache,cacheRead,cacheWrite}`, `outputTokens.{total,text,reasoning}`, and `raw`; core flattens these into its stream usage and then controller usage. Missing usage produces undefined provider counts; the controller emits no usage event if every primary count is absent. Some partially missing fields are filled with zero, so a populated event does not independently certify every billing category was measured. These are token measurements, not dollar charges or prices.

Evidence: [installed numbered source](evidence/narrow-shape/installed-source.md): `@mastra/code-sdk@1.14.0 dist/agents/mastracode-gateway.js:75–85,287–305,381–425`; `dist/headless/run-mc.js:56–61`; `@ai-sdk/openai@3.0.131 dist/index.js:3039–3078`; `@ai-sdk/openai-compatible@2.0.87 dist/index.js:68–104,658,772–773,883–894,1809`; `@mastra/core@1.78.0 dist/stream-Ty0oC3da.js:1164–1205`, `dist/agent-controller/types.d.ts:437–448`, `dist/agent-controller-DRiP9C5v.js:123–138,1031–1054`. Stock custom-provider construction does not enable `includeUsage`; [the learning test](../../../framework/@mastra/code-sdk/usage-request.test.mjs) observes its actual streaming request with no `stream_options.include_usage`, then stops it before network dispatch. [Passing output](evidence/narrow-shape/learning-tests.txt). No provider response was fabricated and no live usage was claimed.

## b. Unattended subscription use and renewal

**Yes, once Todd has authorized the subscription: the SDK can use its saved ChatGPT sign-in and refresh expired access tokens unattended, while initial sign-in or recovery from rejected refresh still requires account authorization.**

Evidence: [installed numbered source](evidence/narrow-shape/installed-source.md), `@mastra/code-sdk@1.14.0 dist/auth/providers/openai-codex.js:132–153,280–310,403–419,483–515`; `dist/auth/storage.js:655–746`; `dist/providers/openai-codex.js:95–131,141–182`. `getOAuthCredential` refreshes expired credentials, persists the new credentials and deduplicates concurrent refresh; the stock provider uses the OAuth refresh-token grant without a keyboard callback. Failed refresh yields an authorization-required failure rather than an invented fresh login. [The local storage learning test](../../../framework/@mastra/code-sdk/credentials.test.mjs) reopens a synthetic unexpired OAuth credential and obtains its bearer with all network blocked. It does not prove Todd's live subscription or a real refresh; the renewal answer is settled from installed source, as authorized. No real account action is needed for this research finding, and none was performed.

## c. Credential storage and builder isolation

**Yes, the adapter can keep credentials out of builder environments and files through stock runtime credential/provider sources, but default local storage is plaintext `auth.json` and must not be treated as secret from a builder that can read that file.**

Default directories are Linux `${XDG_DATA_HOME:-~/.local/share}/mastracode`, Windows `%APPDATA%/mastracode` (fallback `~/AppData/Roaming/mastracode`), and macOS `~/Library/Application Support/mastracode`, overridable by `MASTRA_APP_DATA_DIR` or an explicit `AuthStorage` path. `auth.json` contains API keys (`type: api_key`, `key`) and OAuth access/refresh/expiry plus account registry records. It is written mode 0600. File-backed custom-provider settings can also contain `apiKey` in `settings.json`; the stock local bootstrap can export saved keys into process environment.

Evidence: [installed numbered source](evidence/narrow-shape/installed-source.md), `@mastra/code-sdk@1.14.0 dist/utils/project.js:125–147`, `dist/auth/storage.js:101–112,226–267,301–342`, `dist/auth/types.d.ts:1–10,118–152`, `dist/onboarding/settings.js:314–317,835–846`, `dist/index.js:250–280`. The public `CredentialStore`/`setCredentialStoreProvider` and runtime `setCustomProvidersSource` seams allow adapter-owned credentials without secret-bearing builder settings; registered credential stores suppress the bootstrap's key-to-env export, and `allowEnvironmentFallback: false` suppresses inherited-key fallback. [Declarations](evidence/narrow-shape/installed-source.md): `dist/agents/credential-resolver.d.ts:31–62,84–93`, `dist/agents/custom-provider-source.d.ts:1–42`; model routing uses those seams in `dist/agents/model.js:114–169`.

[The learning tests](../../../framework/@mastra/code-sdk/credentials.test.mjs) verify actual plaintext auth persistence/mode and runtime custom-provider resolution with no key written into settings or exported into the environment. [Passing output](evidence/narrow-shape/learning-tests.txt). Builder command environment filtering remains adapter work; the SDK does not perform it automatically. This finding is functional isolation under Todd's accepted ubuntu/admin risk, not a claim that the SDK prevents that administrator reading another process or credential store.

## Question for Todd

Stock routing does not guarantee token usage from every custom provider. To keep every request within the $1 ceiling, should a source that omits usage be refused, with further card requests blocked while its usage is unknown?
