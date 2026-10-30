---
name: redis
description: Use Redis 7 correctly from application code with ioredis, node-redis, redis-py or go-redis. Covers choosing data structures, key naming and TTLs, caching patterns and invalidation, rate limiting, pub/sub versus streams, distributed locks and their limits, pipelines and Lua scripts, memory and eviction, and local setup. Use when a project depends on redis, ioredis, redis-py or go-redis, or when adding caching, queues, sessions, rate limits or locks.
---

# Redis

Assumes Redis 7.x (or Valkey/compatible) with ioredis 5 / node-redis 4, redis-py 5, go-redis 9. Check `redis-cli INFO server | grep redis_version` and the client version in the lockfile.

## When to use

- Adding caching, sessions, rate limiting, counters, leaderboards, queues or locks.
- Choosing data structures and key layouts; setting TTLs and eviction policy.
- Debugging high memory, slow commands, connection errors, or stale cache bugs.

## Project conventions to detect first

1. Client and wrapper: `ioredis`, `redis` (node-redis), `redis` (python, sync or `redis.asyncio`), `go-redis`; existing wrapper module (`lib/redis.ts`, `cache.py`) with a shared client. Reuse it; do not create new connections per request.
2. Deployment: single node, Sentinel, Cluster (hash tags `{...}` needed for multi-key ops), managed (ElastiCache, Upstash, Redis Cloud). TLS (`rediss://`) and auth in `REDIS_URL`.
3. Key naming already in use: prefix/namespace (`app:env:entity:id`), separator (`:`), versioning (`v2:`), serialization (JSON, msgpack).
4. Libraries built on Redis: BullMQ/Sidekiq/Celery/RQ/Asynq (queues), `connect-redis`/`express-session`, `rate-limiter-flexible`, `cache-manager`, `redlock`. Prefer them over hand-rolled implementations.
5. Eviction policy: `CONFIG GET maxmemory-policy` (`noeviction` default; caches want `allkeys-lru`/`allkeys-lfu`); whether Redis is used as a cache (data loss OK) or a store (persistence required).

## Core guidance

### Data structures: pick by access pattern

| Need | Structure | Commands |
| --- | --- | --- |
| Cache a blob, session, token | String | `SET key val EX 3600`, `GET`, `SET ... NX` |
| Counter, rate limit window | String (int) | `INCR`, `INCRBY`, `EXPIRE` |
| Object with fields updated independently | Hash | `HSET`, `HGET`, `HGETALL`, `HINCRBY` |
| Queue / recent-N list | List | `LPUSH`+`BRPOP`, `LTRIM` |
| Unique membership, tags | Set | `SADD`, `SISMEMBER`, `SINTER` |
| Leaderboard, scheduled jobs, sliding windows | Sorted set | `ZADD`, `ZRANGE ... BYSCORE`, `ZREMRANGEBYSCORE` |
| Event log, consumer groups, replay | Stream | `XADD`, `XREADGROUP`, `XACK`, `XAUTOCLAIM` |
| Fire-and-forget broadcast | Pub/Sub | `PUBLISH`, `SUBSCRIBE` |
| Approximate unique counts | HyperLogLog | `PFADD`, `PFCOUNT` |
| Feature flags per user, bitmaps | Bitmap | `SETBIT`, `BITCOUNT` |
| Geo queries | Geo | `GEOADD`, `GEOSEARCH` |

- Hash for objects when you update fields separately or want memory efficiency; a JSON string when you always read/write the whole object. Hash fields have no per-field TTL (7.4+ adds `HEXPIRE`; check version).
- Sorted sets with timestamp scores give sliding windows and delayed jobs.

### Keys and TTLs

- Name keys `app:entity:id[:facet]` (`shop:user:42:profile`); keep them short but readable; never use user input unescaped as a key segment.
- Set a TTL on every cache key (`SET k v EX n`, `EXPIRE`); keys without TTL are a decision, not a default. Add jitter (`ttl + rand(0, ttl*0.1)`) to avoid synchronized expiry stampedes.
- Never run `KEYS *` in production; use `SCAN` with `MATCH` and `COUNT` for iteration, `UNLINK` instead of `DEL` for large values.
- In Cluster, multi-key commands and Lua need all keys in one slot: `{user:42}:profile`, `{user:42}:sessions`.
- Keep values small (< 100 KB); large values block the single-threaded event loop on serialization and network.

### Caching patterns

- Cache-aside (read-through in app): `GET` -> miss -> load from DB -> `SET EX`. Return DB result on cache errors; the cache must never be a hard dependency for reads.
- Write path: invalidate (`DEL`) on write rather than updating cache values, unless the value is trivially derivable. Delete after the DB commit, not before.
- Stampede protection for hot keys: `SET lock:key 1 NX PX 5000` so one caller recomputes while others serve stale or wait briefly; or probabilistic early expiration.
- Negative caching (cache "not found" briefly) for lookups that often miss.
- Version keys (`user:42:v3`) or a namespace version counter to invalidate groups without scanning.
- Serialize with JSON unless size matters; include a schema version if the shape changes.

### Rate limiting

```lua
-- fixed window: returns current count
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return c
```

- Fixed window (`INCR` + `PEXPIRE` atomically, as above) is simplest; sliding window with a sorted set (`ZADD now`, `ZREMRANGEBYSCORE -inf now-window`, `ZCARD`) is fairer; token bucket in Lua for burst control.
- Use `rate-limiter-flexible`, `express-rate-limit` with the Redis store, or `limits` (Python) if already present.

### Pub/Sub vs Streams

- Pub/Sub: at-most-once, no persistence, no replay; subscribers that disconnect miss messages. Good for cache-invalidation broadcasts, live updates. Subscriber connections are dedicated (cannot run other commands); use a separate client.
- Streams: persistent, consumer groups, acknowledgements, replay from an ID, `XAUTOCLAIM` for dead consumers, `MAXLEN ~ n` to cap. Use for job/event processing with delivery guarantees. For mature job queues use BullMQ (Node), Celery/RQ/Arq (Python), Asynq (Go) rather than writing your own.

### Locks

```ts
// acquire
const token = crypto.randomUUID();
const ok = await redis.set(`lock:${name}`, token, 'PX', 10_000, 'NX');
// release (only if we still own it)
await redis.eval(`if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`, 1, `lock:${name}`, token);
```

- Always `NX` + `PX` + a unique token, and release via the compare-and-delete script.
- A single-node Redis lock is not safe against failover or GC pauses; it is fine for best-effort deduplication, not for correctness-critical mutual exclusion. For that, use the database (`SELECT ... FOR UPDATE`, unique constraints) or a consensus store. Redlock across independent nodes improves but does not eliminate the problem; read the Redlock critique before relying on it.
- Lock TTL must exceed the worst-case work time, or extend it with a watchdog (`redlock`'s `extend`).

### Pipelines, transactions, scripts

- Pipeline independent commands to cut round trips: ioredis `redis.pipeline().get(a).get(b).exec()`, redis-py `with r.pipeline() as p: ...; p.execute()`, go-redis `rdb.Pipelined`.
- `MULTI`/`EXEC` groups commands atomically but has no rollback and cannot branch on results; use `WATCH` for optimistic checks or Lua for read-modify-write.
- Lua scripts (`EVAL`/`EVALSHA`, or Redis Functions in 7) run atomically; keep them short, deterministic, and pass keys via `KEYS` (required for Cluster). ioredis `defineCommand` and redis-py `register_script` handle `EVALSHA` caching.

### Clients

- One long-lived client per process (plus a dedicated one for subscribe/blocking commands). Handle `error` events (ioredis emits them; an unhandled `error` crashes Node).
- Set `connectTimeout`, command timeouts, and `maxRetriesPerRequest` (ioredis) / `socket.reconnectStrategy` (node-redis); fail fast on cache paths.
- node-redis requires `await client.connect()`; ioredis connects lazily on first command. redis-py: `redis.Redis.from_url(url, decode_responses=True)`; async via `redis.asyncio`. go-redis: `redis.NewClient(opt)`; pass `ctx` everywhere.
- Use `decode_responses=True`/string returns deliberately; binary values (msgpack, protobuf) need raw bytes.

## Common tasks

### Add a cache around a slow read

1. Define the key (`app:entity:id`), TTL and serialization; add a helper `getOrSet(key, ttl, loader)`.
2. Wrap the loader; on Redis error, log and call the loader directly.
3. Invalidate (`UNLINK`) in the write path after commit; cover with a test that writes then reads.
4. Observe hit rate: `INFO stats` (`keyspace_hits`/`keyspace_misses`).

### Store sessions

- Use the framework's Redis session store (`connect-redis`, `django-redis`, `gorilla/sessions` Redis store). Key by session ID, TTL = session lifetime, rolling expiry on activity.

### Local setup and inspection

```bash
docker run -d --name redis -p 6379:6379 redis:7-alpine
redis-cli ping
redis-cli --scan --pattern 'app:user:*' | head
redis-cli TTL app:user:42 ; redis-cli TYPE app:user:42 ; redis-cli MEMORY USAGE app:user:42
redis-cli INFO memory | grep -E 'used_memory_human|maxmemory_human|maxmemory_policy'
redis-cli SLOWLOG GET 10
redis-cli MONITOR        # dev only; heavy on production
redis-cli --bigkeys      # find large keys (uses SCAN)
redis-cli CLIENT LIST
```

Use `redis-cli -u "$REDIS_URL"` for remote; `--tls` for TLS endpoints.

### Diagnose high memory or latency

1. `INFO memory`, `--bigkeys`, `MEMORY USAGE` on suspects; check keys without TTL (`SCAN` + `TTL -1`).
2. `SLOWLOG GET`; look for `KEYS`, `SMEMBERS`/`HGETALL`/`LRANGE 0 -1` on huge structures, big Lua scripts. Replace with `SSCAN`/`HSCAN`, ranges, or restructure.
3. `INFO stats` for `evicted_keys` and `rejected_connections`; `INFO clients` for `connected_clients` growth (connection leak).
4. Set `maxmemory` and an `allkeys-*` policy for pure caches.

## Pitfalls

- Treating Redis as the source of truth without persistence (`appendonly yes`) or replication; defaults are tuned for cache use.
- `KEYS pattern` or `FLUSHALL`/`FLUSHDB` in production code or scripts; `FLUSH*` only with explicit user confirmation and the target instance named.
- Cache keys without TTL filling memory until `OOM command not allowed` under `noeviction`.
- Serving stale data after writes because invalidation runs before the DB commit, or races with a concurrent read repopulating the old value (use short TTLs or versioned keys).
- Using Pub/Sub for anything that must not be lost.
- Locks released with plain `DEL` (deleting another worker's lock) or without a TTL (deadlock on crash).
- Blocking commands (`BRPOP`, `SUBSCRIBE`) on the shared client stall every other command.
- Storing large JSON blobs and doing `GET`+parse+modify+`SET` under concurrency; use a Hash or Lua for partial updates.
- Cluster `CROSSSLOT` errors from multi-key commands without hash tags.
- Creating a new client per request in serverless; use a connection pooler/HTTP-based client (Upstash) or keep a module-level client.
- Timezone/clock assumptions in sorted-set windows across app servers; use Redis `TIME` or monotonic server-side scores if skew matters.

## Verification

```bash
redis-cli ping                                                   # reachable
npm test / pytest / go test                                      # integration tests against a real Redis (container or redis-memory-server)
redis-cli --scan --pattern 'app:*' | head -20                    # key naming as designed
redis-cli --scan --pattern 'app:*' | xargs -n1 redis-cli TTL | sort -n | head   # no -1 TTLs on cache keys
redis-cli INFO stats | grep -E 'keyspace_(hits|misses)'          # hit rate improving after cache change
```

## References

- Redis commands: https://redis.io/docs/latest/commands/
- Data types: https://redis.io/docs/latest/develop/data-types/
- Key eviction: https://redis.io/docs/latest/develop/reference/eviction/
- Streams: https://redis.io/docs/latest/develop/data-types/streams/
- Distributed locks (and limits): https://redis.io/docs/latest/develop/use/patterns/distributed-locks/
- Pipelining: https://redis.io/docs/latest/develop/use/pipelining/
- ioredis: https://github.com/redis/ioredis
- node-redis: https://github.com/redis/node-redis
- redis-py: https://redis.readthedocs.io/
- go-redis: https://redis.uptrace.dev/
