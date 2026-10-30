# Review checklist

Use as a lens while reading. Report only items that are actually wrong, with evidence.

## Intent and scope
- Does the change do what the title/description says, all of it, and nothing unrelated?
- Does it match the approved plan/design document, if one exists?
- Are there leftover debug statements, commented-out code, TODOs without owners, or unrelated reformatting?

## Correctness
- Off-by-one, boundary conditions (empty, one element, max size, negative, zero, overflow).
- Null / undefined / optional handling on every new access path.
- Type coercions, equality semantics, floating point, timezone and locale handling.
- Early returns or exceptions that skip cleanup, unlock, commit or logging.
- Changed function contracts: are all callers updated? Is the old behaviour still assumed anywhere?
- Default values and configuration precedence.
- Idempotency of operations that may be retried.

## Error handling
- Errors are caught at the right level, not swallowed silently; logs include context.
- Partial failure leaves data consistent (transactions, compensating actions).
- User-facing errors do not leak internals; internal errors are not hidden from operators.
- Timeouts and retries have bounds and backoff.

## Concurrency and state
- Shared mutable state guarded; no check-then-act races.
- Async code awaits everything it must; no unhandled promise rejections or fire-and-forget without justification.
- Ordering assumptions between events, jobs or requests are explicit.
- Resource lifecycles: connections, file handles, subscriptions, timers are released.

## Security
- Input validation at trust boundaries (HTTP, CLI, files, queues).
- Injection: SQL, shell, path traversal, template, header, log.
- AuthN/AuthZ on every new endpoint or action; object-level authorization (can this user touch this id?).
- Secrets not hard-coded or logged; new config does not weaken defaults.
- Deserialization of untrusted data, SSRF on user-supplied URLs, unsafe HTML.
- Dependencies: new packages justified, pinned, from trusted sources.

## Data and migrations
- Schema changes are backward compatible with the currently deployed version, or the deploy order is documented.
- Migrations are reversible or a rollback is described; large tables handled without locking.
- Backfills are idempotent and resumable.
- Data invariants enforced where they should be (DB constraint vs. application).

## Performance
- N+1 queries, missing indexes for new query patterns, unbounded result sets without pagination.
- Work inside loops that could be hoisted; repeated parsing/serialization; large allocations.
- Caching: correctness of invalidation, key collisions, TTLs.
- Hot paths: does the change add latency where the design document set a budget?

## API and compatibility
- Public interface changes versioned or additive; removed fields and renamed parameters flagged.
- Serialization formats unchanged, or consumers updated.
- Feature flags default safely.

## Tests
- New behaviour has tests at the right level; risky logic (parsing, money, auth, concurrency) has edge-case tests.
- Tests assert behaviour, not implementation details; no sleeps for synchronization; deterministic.
- Removed or weakened tests are justified.
- Test names describe the scenario.

## Readability and maintainability
- Names say what things are; functions do one thing; no deep nesting that a guard clause would fix.
- Duplicated logic that the codebase already has a helper for.
- Comments explain *why*, not *what*; stale comments updated.
- Public functions and config documented where the project documents them.

## Operations
- Logging at the right level with correlation ids; metrics for new paths; alerts if SLOs are affected.
- Config documented; env vars added to examples and deployment manifests.
- Docs, changelog and migration guides updated.
