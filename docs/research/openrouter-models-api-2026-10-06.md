# OpenRouter models API observation - 2026-10-06

Research note for #211. This records an observation of OpenRouter's public model catalog; it is
not a Factory model mapping and does not assert that every listed model is configured in Factory.

## Retrieval

- Endpoint: [`GET https://openrouter.ai/api/v1/models`](https://openrouter.ai/api/v1/models)
- Initially retrieved: `2026-10-06T23:59:43.8027309Z` (HTTP `200`), then saved as the
  test fixture at `ops/factory/app/fixtures/openrouter-models-2026-10-06.json` from a second
  HTTP `200` response at `2026-10-07T00:05:22.6242695Z`.
- The committed raw response is 775,271 UTF-8 bytes with SHA-256
  `b4ea978da27d2fa5635be4fa8a4434f228bc6db5a888bf43ece1019d893f7797`.

## Verified catalog shape and ID rule

The response's top-level object had `data`, `total_count`, and `links`. `total_count` was `466`,
`data` contained `466` model objects, and `links.next` was `null`. Every entry had a non-empty,
unique `id` (466 unique IDs).

`id` is the exact catalog key to use for a checkable OpenRouter match: preserve it verbatim rather
than reconstructing it from `name`, `canonical_slug`, or a provider/model display label. All 466
observed IDs contained `/`; 89 also contained `:` suffixes, so a mapper must not assume that the
portion after `/` is only an unqualified model name. For example, the first returned entry used
`id` `google/gemini-nano-banana-2.1` and `name` `Google: Nano Banana 2.1`.

The observed model objects exposed these fields (availability varies by object): `id`,
`canonical_slug`, `hugging_face_id`, `name`, `created`, `description`, `context_length`,
`architecture`, `pricing`, `top_provider`, `per_request_limits`, `supported_parameters`,
`default_parameters`, `supported_voices`, `knowledge_cutoff`, `expiration_date`, `links`, and
`reasoning`. The `architecture` object on the first entry contained `modality`,
`input_modalities`, `output_modalities`, `tokenizer`, and `instruct_type`.

Source for all observed response facts: [OpenRouter models endpoint](https://openrouter.ai/api/v1/models)
(retrieved at the timestamp above).

## Factory identifier inventory

The Factory-side sources were read on the authorized server without opening the observability
DuckDB or calling Factory's HTTP API. The running settings file
`/var/lib/julia-factory/.local/share/mastracode/settings.json` declares
`models.subagentModels.default` and `code-review` as
`command-code/deepseek/deepseek-v4-flash`. The service environment declares
`JULIA_REVIEWER_MODELS=moonshotai/Kimi-K2.7-Code` and
`DEFAULT_OM_MODEL_ID=deepseek/deepseek-flash`. The Factory reviewer settings include
`openai/gpt-6-sol` and `deepseek/deepseek-v4-pro`.

The permitted PostgreSQL read,
`SELECT DISTINCT token->>'provider', token->>'model' FROM factory_issue_cost_records CROSS JOIN
LATERAL jsonb_array_elements(record->'tokens') token`, returned no rows at this time. Therefore
these configured identifiers, rather than historical token rows, are the Round A inventory.

Exact OpenRouter IDs found in the committed response are `openai/gpt-6-sol`,
`moonshotai/kimi-k2.7-code`, `deepseek/deepseek-v4-pro`, and
`deepseek/deepseek-v4-flash`. There is no exact `deepseek/deepseek-flash` catalog ID; it remains
unmapped rather than inferred.
