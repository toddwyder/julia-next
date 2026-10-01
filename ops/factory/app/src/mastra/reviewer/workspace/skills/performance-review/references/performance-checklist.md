# Performance Checklist

## The five reviewer checks

1. **unit tests** — meaningful behavior/regression coverage through appropriate interfaces.
2. **integration tests at affected boundaries** — exercise the changed component/storage/service/provider contract across the boundary.
3. **end-to-end for the changed journey** — the affected user journey through the assembled test app with test data, including failure paths.
4. **a clean browser console** — no unexpected console errors/unhandled failures (no browser surface: mark not applicable).
5. **logging good enough to find a root cause** — lasting logs/measurements identify the failing operation and context without exposing secrets.

## Quick Reference

### Database

- [ ] No queries inside loops (N+1)
- [ ] Indexes exist for WHERE/JOIN/ORDER BY columns
- [ ] Queries have LIMIT clauses where appropriate
- [ ] Connection pooling is configured
- [ ] Expensive queries are cached

### Memory

- [ ] Event listeners are cleaned up
- [ ] Timers/intervals are cleared
- [ ] Caches have size limits or TTL
- [ ] Large data sets are paginated, not loaded entirely
- [ ] Streams used for large file processing

### Frontend

- [ ] Components memoized where appropriate
- [ ] Lists are virtualized if > 100 items
- [ ] Images are lazy-loaded and properly sized
- [ ] Code splitting for routes/features
- [ ] Heavy computation offloaded to web workers

### Network

- [ ] API responses are cached appropriately
- [ ] Parallel requests where dependencies allow
- [ ] Pagination for list endpoints
- [ ] Compression enabled (gzip/brotli)
- [ ] CDN for static assets

### General

- [ ] No synchronous I/O in request handlers
- [ ] Logging doesn't impact performance in production
- [ ] Batch operations where possible
- [ ] Debounce/throttle rapid-fire events
