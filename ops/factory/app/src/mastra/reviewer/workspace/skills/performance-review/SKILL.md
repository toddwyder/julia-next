---
name: performance-review
description: Performance-focused code review for identifying bottlenecks and optimization opportunities
version: 1.0.0
metadata:
  tags:
    - code-review
    - performance
---

# Performance Review

When reviewing code for performance issues, check each category below. Reference the detailed checklist in `references/performance-checklist.md`.

## Database & Queries

- N+1 query patterns (queries inside loops)
- Missing database indexes for frequently queried fields
- Unbounded queries without LIMIT/pagination
- SELECT \* instead of selecting only needed columns
- Missing connection pooling

## Memory & Resources

- Memory leaks: event listeners not removed, intervals not cleared, growing caches without bounds
- Large objects held in memory unnecessarily
- Unbounded arrays or maps that grow with usage
- Missing cleanup in component unmount/destroy lifecycle

## Rendering (Frontend)

- Unnecessary re-renders (missing React.memo, useMemo, useCallback where appropriate)
- Large component trees re-rendering for small state changes
- Missing virtualization for long lists
- Synchronous heavy computation blocking the main thread
- Large bundle sizes from unnecessary imports

## API & Network

- Missing caching for frequently accessed, rarely changing data
- Sequential API calls that could be parallelized
- Missing pagination for large data sets
- Over-fetching data (requesting more than needed)
- Missing request deduplication

## Algorithmic Complexity

- O(n²) or worse operations on potentially large datasets
- Repeated computation that could be memoized
- String concatenation in loops (use array join or template literals)
- Unnecessary sorting or filtering passes

## The five reviewer checks

Record evidence tied to the change for each check, or explain why it does not apply; missing evidence is a finding.

1. **unit tests** — meaningful behavior/regression coverage through appropriate interfaces.
2. **integration tests at affected boundaries** — exercise the changed component/storage/service/provider contract across the boundary.
3. **end-to-end for the changed journey** — the affected user journey through the assembled test app with test data, including failure paths.
4. **a clean browser console** — no unexpected console errors/unhandled failures (no browser surface: mark not applicable).
5. **logging good enough to find a root cause** — lasting logs/measurements identify the failing operation and context without exposing secrets.

## Severity Levels

- 🔴 **CRITICAL**: Will cause performance degradation under normal load
- 🟠 **HIGH**: Will cause issues at scale
- 🟡 **MEDIUM**: Optimization opportunity with measurable impact
- 🔵 **LOW**: Minor optimization suggestion
