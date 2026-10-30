# Data structure catalogue: what to record for every structure

The Data model section is complete only when **every** data structure the feature touches is listed, including existing ones that are only read. Use this checklist per structure.

## Required for each structure

| Item | What to write |
|---|---|
| Name | The identifier as it appears (or will appear) in code or schema. |
| Kind | class, struct, interface/type, enum, database table, collection/document, event/message payload, cache entry, config object, file format. |
| Status | `new`, `changed` (list the changed fields), or `read-only` (the feature reads it, does not change it). |
| Defined in | Exact file path and symbol, or migration/schema name. For `new`, the intended path. |
| Purpose | One sentence. |
| Fields | Table: name, type, nullable, description, constraints (unique, FK, index, enum values, format). For changed structures mark added/removed/modified fields. |
| Invariants | Rules that must hold at all times, and where they are enforced (DB constraint, validation layer, type system). |
| Lifecycle | Who creates it, who mutates it, who deletes it, retention. |
| Persistence / transport | Where it lives (table, key pattern, topic, memory) and serialization format. |
| Size and growth | Typical and maximum size per item; expected count; growth rate. |
| Relationships | References to other structures and cascade/ownership semantics. |
| Access patterns | How it is queried or traversed, and which indexes support that. |
| Complexity link | Which operations in section 7 touch it and dominate its cost. |

## Common omissions to check for

- Request and response DTOs, and the difference between them and the stored model.
- Enums and status fields with their allowed transitions (state machine).
- Join tables, index definitions, unique constraints.
- Cache keys, TTLs, and invalidation triggers.
- Background job payloads and idempotency keys.
- Configuration and feature flags read by the feature.
- Third-party API payloads that are mapped into local structures.
- Frontend state shape (store slices, query cache keys) when the feature has UI.

## Field table example

| Field | Type | Nullable | Description | Constraints / index |
|---|---|---|---|---|
| id | uuid | no | Primary key | PK |
| user_id | uuid | no | Owner | FK users(id) ON DELETE CASCADE, index (user_id, created_at) |
| status | enum(pending, active, archived) | no | Lifecycle state; transitions: pending→active→archived | default pending |
| payload | jsonb | yes | Free-form attributes, max 16 KB | size validated in service layer |
| created_at | timestamptz | no | | default now() |

## Complexity statement example

> `listActiveForUser(userId, page)` runs one query using index `(user_id, created_at)`; time O(log n + k) where n = rows in `things` and k = page size (≤ 100); space O(k). No N+1: related `tags` are fetched with a single `IN` query over the page's ids.
