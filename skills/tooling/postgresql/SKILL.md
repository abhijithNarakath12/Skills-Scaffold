---
name: postgresql
description: Use PostgreSQL 14-17 correctly from application code and migrations. Covers schema design and data types (jsonb, arrays, uuid, timestamptz, numeric), btree/GIN/partial/covering indexes, reading EXPLAIN ANALYZE, transactions and isolation levels, locking pitfalls, safe migrations on large tables, connection pooling (pgbouncer, pool sizing) and the psql workflow. Use when a project depends on pg, postgres, psycopg, asyncpg, pgx, lib/pq, npgsql or Doctrine DBAL, or when writing SQL, migrations or queries for Postgres.
---

# PostgreSQL

Assumes PostgreSQL 14-17. Check with `SELECT version();` or `psql --version`. Driver-level advice applies to node-postgres (`pg`), `postgres.js`, psycopg 3, asyncpg, pgx, lib/pq, Npgsql.

## When to use

- Designing tables, writing migrations, choosing indexes or data types.
- Writing or optimizing queries, reading `EXPLAIN ANALYZE`, fixing slow endpoints.
- Handling transactions, isolation, deadlocks, lock timeouts, connection pool exhaustion.
- Working in `psql` or diagnosing a running database.

## Project conventions to detect first

1. Migration tool: Prisma, Drizzle, Knex, TypeORM, Flyway, Liquibase, Alembic, Django, Rails, golang-migrate, sqlx, dbmate. Use its CLI to create migrations; never hand-edit applied migrations.
2. Access layer: ORM (Prisma, SQLAlchemy, GORM, ActiveRecord), query builder, or raw SQL with parameterization. Match it; do not mix raw SQL into an ORM codebase without reason.
3. Naming: `snake_case` tables/columns, singular vs plural tables, `id` type (`bigint identity`, `uuid`), `created_at`/`updated_at` conventions, soft deletes.
4. Connection setup: `DATABASE_URL`, pool size, `statement_timeout`, pgbouncer in transaction mode (which forbids session features like prepared statements by name, `SET`, advisory locks held across transactions, `LISTEN`).
5. Extensions in use: `pgcrypto`, `uuid-ossp`, `pg_trgm`, `postgis`, `citext`, `pg_stat_statements` (`SELECT * FROM pg_extension;`).
6. Schema dump or ERD: `schema.sql`, `prisma/schema.prisma`, `models.py`; read it before adding tables.

## Core guidance

### Schema and types

```sql
CREATE TABLE orders (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id   uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  customer_id bigint NOT NULL REFERENCES customers(id),
  status      text NOT NULL CHECK (status IN ('pending','paid','shipped','cancelled')),
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags        text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_customer_id_idx ON orders (customer_id);
```

- `bigint GENERATED ALWAYS AS IDENTITY` over `serial`; `uuid` (`gen_random_uuid()`, built in since 13) for externally visible IDs. UUIDv4 primary keys fragment btree indexes on large tables; consider identity + public uuid.
- `timestamptz` always; never `timestamp` (without time zone). Store in UTC; convert in the app.
- `text` over `varchar(n)` unless a hard limit is a business rule; use `CHECK` for constraints. `citext` for case-insensitive unique emails.
- Money: `numeric(12,2)` or integer cents; never `float`/`real`.
- `jsonb` (not `json`) for semi-structured data; keep columns you filter/join on relational. Index with GIN: `CREATE INDEX ... USING gin (metadata jsonb_path_ops)` for `@>` queries; expression btree index for a single key: `((metadata->>'sku'))`.
- Arrays for small, bounded sets queried with `@>`/`&&` (GIN index); a join table when you need FKs or per-element metadata.
- Enums: `text` + `CHECK` or a lookup table is easier to evolve than `CREATE TYPE ... AS ENUM` (adding values is fine, removing/reordering is not).
- Every FK column gets an index (Postgres does not create one automatically). `ON DELETE` behaviour explicit.
- `NOT NULL` by default; nullable columns are a deliberate decision.

### Indexes

- Btree (default) for equality/range/ORDER BY; composite index column order: equality columns first, then range/sort column. `(customer_id, created_at DESC)` serves `WHERE customer_id = $1 ORDER BY created_at DESC`.
- Partial index for hot subsets: `CREATE INDEX ... ON jobs (run_at) WHERE status = 'queued';`
- Covering index: `INCLUDE (col)` to enable index-only scans.
- GIN for `jsonb`, arrays, full-text (`tsvector`), trigram (`pg_trgm`) for `LIKE '%x%'`/`ILIKE`. BRIN for huge append-only tables filtered by time.
- Unique constraints via `UNIQUE` (creates the index). Case-insensitive uniqueness: `UNIQUE (lower(email))` as a unique index.
- Create indexes `CONCURRENTLY` in production (cannot run inside a transaction; most migration tools need a flag to disable the wrapping transaction).
- Find unused/duplicate indexes: `pg_stat_user_indexes` (`idx_scan = 0`), `pg_indexes`.

### Queries

- Always parameterize (`$1`, `%s`, `?` per driver); never interpolate values. Identifiers cannot be parameters; whitelist them.
- Select the columns you need; `SELECT *` breaks when columns are added and defeats index-only scans.
- Pagination: keyset (`WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC, id DESC LIMIT 50`) over `OFFSET` for large tables.
- Upsert: `INSERT ... ON CONFLICT (key) DO UPDATE SET ... = EXCLUDED....`. Use `RETURNING` to avoid a second query.
- Bulk insert with multi-row `VALUES`, `COPY`, or `unnest($1::bigint[], $2::text[])`; not one `INSERT` per row.
- Avoid N+1: join or batch with `= ANY($1)`; use `LATERAL` joins for top-N-per-group.
- CTEs are not optimization fences since 12 (unless `MATERIALIZED`); still, inline if the planner misestimates.
- Read `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)`: look for `Seq Scan` on large tables with selective filters, `Rows Removed by Filter`, estimates vs actual rows off by 10x+ (stale stats: `ANALYZE table`), `Nested Loop` with large outer sets, `Sort` spilling to disk (`external merge`), and `Hash` batches > 1. Paste plans into https://explain.dalibo.com/ or https://explain.depesz.com/ for large plans.

### Transactions and locking

- Default isolation is `READ COMMITTED`. Use `REPEATABLE READ` or `SERIALIZABLE` for invariants spanning multiple statements, and retry on `40001` (serialization failure) and `40P01` (deadlock).
- Keep transactions short; never hold one open across network calls or user interaction.
- `SELECT ... FOR UPDATE` to lock rows you will update; `FOR UPDATE SKIP LOCKED` for job queues; `FOR NO KEY UPDATE` when not changing the key to avoid blocking FK inserts.
- Deadlocks come from inconsistent lock order; update rows in a deterministic order (`ORDER BY id`) within a transaction.
- Set `statement_timeout` and `lock_timeout` for app connections (`SET lock_timeout = '5s'` in migrations) so DDL does not queue behind long queries and block everything behind it.
- Advisory locks (`pg_advisory_xact_lock(key)`) for app-level mutual exclusion; not with pgbouncer transaction pooling unless `_xact_` variant.

### Migrations on large tables

- Adding a column with a constant default is instant (11+); adding `NOT NULL` to an existing column requires a scan: add a `CHECK (col IS NOT NULL) NOT VALID`, `VALIDATE CONSTRAINT`, then `SET NOT NULL` (12+ skips the scan).
- Add FKs and CHECKs as `NOT VALID` then `VALIDATE CONSTRAINT` in a separate transaction.
- `CREATE INDEX CONCURRENTLY`; `DROP INDEX CONCURRENTLY`. Check `pg_stat_progress_create_index`.
- Changing a column type rewrites the table; prefer add-new-column, backfill in batches (`UPDATE ... WHERE id BETWEEN ...`), swap, drop old.
- Renaming columns/tables breaks running app versions; deploy code that handles both names first.
- Never run a long `UPDATE`/`DELETE` on millions of rows in one transaction; batch by primary key ranges.

### Connections

- Pool size is small: a few connections per CPU core on the DB server, shared across app instances; use pgbouncer for many app replicas or serverless.
- Set `application_name` so `pg_stat_activity` is readable.
- Serverless: `@neondatabase/serverless`, pooled connection strings, or pgbouncer transaction mode; avoid per-request connects.
- Close/release connections in `finally`; a leaked client exhausts the pool silently.

## Common tasks

### Add a table or column

1. Generate a migration with the project's tool; write forward and backward steps.
2. Follow the type and index rules above; add FK indexes; `CONCURRENTLY` for indexes on existing large tables.
3. Run the migration locally, inspect with `\d+ table`, update the ORM model/types, run tests.

### Optimize a slow query

1. Get the real query and parameters (log, `pg_stat_statements` ordered by `total_exec_time`).
2. `EXPLAIN (ANALYZE, BUFFERS)` with production-like data; identify the dominant node.
3. Fix: add/reshape an index, rewrite the predicate to be sargable (no functions on indexed columns unless an expression index exists), add `LIMIT`, keyset pagination, or denormalize.
4. Re-run `EXPLAIN ANALYZE`; confirm buffers and time dropped; add a regression check if the repo has query tests.

### Inspect a live database

```bash
psql "$DATABASE_URL"
\dt \d+ orders \di \dx \l \dn            # tables, table detail, indexes, extensions, databases, schemas
\x auto                                  # expanded output for wide rows
\timing on
SELECT pid, state, wait_event_type, now()-query_start AS age, left(query,80) FROM pg_stat_activity WHERE state <> 'idle' ORDER BY age DESC;
SELECT pg_size_pretty(pg_total_relation_size('orders'));
SELECT * FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;
SELECT pg_terminate_backend(<pid>);      # only with confirmation
```

- `psql -f file.sql`, `-c "SQL"`, `--csv` for exports; `\copy table TO 'out.csv' CSV HEADER` client-side.

### Implement a job queue

```sql
UPDATE jobs SET status = 'running', locked_at = now()
WHERE id = (
  SELECT id FROM jobs WHERE status = 'queued' AND run_at <= now()
  ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 1
) RETURNING *;
```

Pair with a partial index on `(run_at) WHERE status = 'queued'`.

### Full-text or fuzzy search

- Full text: generated `tsvector` column + GIN index, query with `@@ websearch_to_tsquery('english', $1)`.
- Fuzzy/substring: `CREATE EXTENSION pg_trgm;` + `gin (name gin_trgm_ops)`; query with `ILIKE '%term%'` or `similarity()`.

## Pitfalls

- `timestamp` without time zone and `now()` in a session with a non-UTC timezone produce silently shifted data.
- Missing indexes on FK columns make deletes/updates on the parent table scan the child.
- `OFFSET 100000` reads and discards 100k rows per page.
- `SELECT COUNT(*)` on big tables is a full scan; use estimates (`pg_class.reltuples`) or a counter table when approximate is fine.
- `LIKE '%x'` or functions on indexed columns (`lower(email) = ...` without an expression index) ignore btree indexes.
- Long-running transactions block `VACUUM`, bloat tables and prevent `CREATE INDEX CONCURRENTLY` from finishing; find them in `pg_stat_activity` (`xact_start`).
- `ALTER TABLE` without `lock_timeout` queues behind one slow query and then blocks all traffic.
- Transaction-mode pgbouncer with session features (prepared statements, `SET`, temp tables, `LISTEN`) fails intermittently.
- `NULL` comparisons: `col <> 'x'` excludes NULLs; `NOT IN (subquery)` with a NULL returns nothing; use `NOT EXISTS`.
- Integer `id` columns on tables that will exceed 2^31 rows; use `bigint` from the start.
- Relying on `jsonb` for everything, then needing constraints, joins and indexes you cannot express.

## Verification

```bash
<migration tool> migrate && <migration tool> rollback && <migration tool> migrate   # both directions work
psql "$DATABASE_URL" -c '\d+ <table>'                                               # schema as intended
psql "$DATABASE_URL" -c 'EXPLAIN (ANALYZE, BUFFERS) <query>'                        # expected index used
npm test / pytest / go test                                                         # integration tests against a real Postgres (docker compose, testcontainers)
sqlfluff lint --dialect postgres migrations/                                        # if the repo uses it
```

## References

- PostgreSQL docs: https://www.postgresql.org/docs/current/
- Data types: https://www.postgresql.org/docs/current/datatype.html
- Indexes: https://www.postgresql.org/docs/current/indexes.html
- Using EXPLAIN: https://www.postgresql.org/docs/current/using-explain.html
- Transaction isolation: https://www.postgresql.org/docs/current/transaction-iso.html
- Explicit locking: https://www.postgresql.org/docs/current/explicit-locking.html
- ALTER TABLE lock notes: https://www.postgresql.org/docs/current/sql-altertable.html
- Postgres wiki "Don't Do This": https://wiki.postgresql.org/wiki/Don%27t_Do_This
- pgbouncer features and limitations: https://www.pgbouncer.org/features.html
