# 0015. Fixed reviewer instructions and deferred learning memory

Date: 2026-10-12

Status: Proposed

## Context

Earlier reviewer architectures evaluated LibSQL working memory, semantic memory, and vector stores
to maintain state and reviewer rules across runs. In practice, the working memory store held only
fixed rules, effectively acting as a database holding static constants.

## Decision (Agent Design Choice)

1. The reviewer operates with zero database memory: no working memory, no message history persistence,
   no semantic recall, and no vector embeddings.
2. All standing reviewer rules (exact quote matching, no arbitrary caps, no human questions during
   review, read-only tools, preferring stock features, checking missing tests/logs) and candidate-as-data
   safeguards are supplied directly as fixed prompt instructions (STANDING_RULES).
3. Nothing is injected from one review into another.
4. Learning memory is deferred until demonstrated necessary: returning only after two clean live
   reviews on separate changes and a third review demonstrates a required decision that cannot be made
   from card criteria, candidate diffs, test evidence, and standing rules.

## Consequences

- Eliminates vector dependencies (@mastra/libsql, @mastra/fastembed, @mastra/memory).
- No persisted reviewer history or memory is injected from one review into another.
