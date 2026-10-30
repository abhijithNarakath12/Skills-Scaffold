---
name: sql
description: Write, review and optimise relational SQL for PostgreSQL, MySQL/MariaDB and SQLite. Covers schema design and naming, indexing, writing readable queries (joins, CTEs, window functions), reading EXPLAIN plans, migrations, transactions and isolation, dialect differences and common anti-patterns. Use when editing .sql files, schema or migration files, or writing queries embedded in application code.
---

# SQL

Covers ANSI-style SQL as implemented by PostgreSQL 14+, MySQL 8 / MariaDB 10.6+, and SQLite 3.35+. Dialect differences are called out inline; when a feature matters, confirm with the target database's docs or `SELECT version()` (`sqlite3 --version`).

## When to use

- Editing `.sql` files: schemas, migrations, seeds, views, functions, stored procedures.
- Writing or reviewing queries in application code (ORM raw queries, query builders, repositories).
- Diagnosing slow queries, deadlocks, locking or data-integrity problems.

## Project conventions to detect first

1. Which database: connection strings/env (`DATABASE_URL`, `postgres://`, `mysql://`, `sqlite:///`), Docker services, driver packages (`pg`, `psycopg`, `mysql2`, `better-sqlite3`, `sqlx`, JDBC URLs).
2. Migration tool and its layout: Flyway (`V1__init.sql`), Liquibase, Alembic (`alembic/versions/`), Rails (`db/migrate`, `schema.rb`/`structure.sql`), Prisma (`prisma/migrations`), Drizzle, Knex, golang-migrate (`000001_init.up.sql`/`.down.sql`), dbmate, Atlas, sqitch, Django. Create new migrations with that tool's generator, never by hand-numbering if it has one.
3. Naming conventions already in the schema: `snake_case` plural tables (`users`) vs singular, `id` vs `user_id` primary keys, `created_at`/`updated_at` timestamps, index naming (`idx_<table>_<cols>`, `<table>_<cols>_idx`), FK naming.
4. ID strategy: `bigint identity`/`serial`, `uuid` (v4 vs v7/ULID), application-generated.
5. Query layer: ORM (ActiveRecord, Prisma, SQLAlchemy, Hibernate, EF Core), query builder (Knex, jOOQ, Drizzle), or raw SQL with sqlc/sqlx. Keep queries where the project keeps them.
6. Formatting/linting: `.sqlfluff` (dialect set in config), `pg_format`, `sql-formatter`; keyword casing (UPPER vs lower) in existing files.
7. Multi-tenancy and soft-delete patterns (`tenant_id` on every table, `deleted_at IS NULL` filters); every new query must honour them.

## Core guidance

### Schema design

- Normalise to 3NF by default; denormalise deliberately and document why. One fact in one place.
- Every table: a primary key (`bigint GENERATED ALWAYS AS IDENTITY` in PostgreSQL, `BIGINT AUTO_INCREMENT` in MySQL, `INTEGER PRIMARY KEY` in SQLite), `created_at timestamptz NOT NULL DEFAULT now()`, and `NOT NULL` on every column unless null has a meaning.
- Constraints enforce invariants: `FOREIGN KEY ... ON DELETE RESTRICT|CASCADE|SET NULL` chosen explicitly, `UNIQUE`, `CHECK (price_cents >= 0)`. Application-only validation drifts.
- Types: `timestamptz` not `timestamp` (PostgreSQL); `DATETIME(6)`/`TIMESTAMP` in MySQL (TIMESTAMP is UTC-converted, range to 2038); `numeric(12,2)`/`DECIMAL` for money, never float; `text` (PostgreSQL) or `VARCHAR(n)` with a real limit (MySQL indexes care); `boolean` (MySQL `TINYINT(1)`); `jsonb` (PostgreSQL) for semi-structured data with a GIN index if queried.
- Enumerations: a lookup table or `CHECK (status IN (...))`; PostgreSQL `CREATE TYPE ... AS ENUM` is fine but altering is awkward; MySQL `ENUM` is hard to evolve.
- Names: `snake_case`, no reserved words (`user`, `order`, `group` need quoting; prefer `users`, `orders`), no abbreviations that need a glossary. Junction tables `<a>_<b>` (`post_tags`).

```sql
CREATE TABLE orders (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id  bigint NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  status       text   NOT NULL CHECK (status IN ('pending', 'paid', 'shipped', 'cancelled')),
  total_cents  bigint NOT NULL CHECK (total_cents >= 0),
  placed_at    timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_customer_id_placed_at_idx ON orders (customer_id, placed_at DESC);
```

### Indexing

- Index every foreign key column (PostgreSQL does not do this automatically; MySQL InnoDB does).
- Composite indexes: equality columns first, then range/sort columns; the leftmost prefix must match the query. `(customer_id, placed_at)` serves `WHERE customer_id = ? ORDER BY placed_at`.
- Covering indexes: `INCLUDE (col)` (PostgreSQL 11+) or add trailing columns (MySQL) to enable index-only scans.
- Partial indexes for sparse predicates (PostgreSQL, SQLite): `CREATE INDEX ... ON jobs (run_at) WHERE status = 'queued'`. MySQL has no partial indexes; use a composite.
- Expression indexes for `lower(email)`, `(data->>'sku')`; the query must use the identical expression.
- Unique constraints where uniqueness is a rule; they double as indexes.
- Do not over-index write-heavy tables; each index costs on `INSERT`/`UPDATE`. Drop unused ones (PostgreSQL: `pg_stat_user_indexes.idx_scan`).
- Build large indexes online: `CREATE INDEX CONCURRENTLY` (PostgreSQL, not inside a transaction), `ALGORITHM=INPLACE, LOCK=NONE` (MySQL).

### Writing queries

- Select the columns you need; `SELECT *` only in ad-hoc exploration.
- Explicit `JOIN ... ON`; never comma joins. `LEFT JOIN` + `WHERE right.id IS NULL` for anti-joins, or `NOT EXISTS` (preferred over `NOT IN`, which breaks on NULLs).
- CTEs (`WITH`) for readability; in PostgreSQL 12+ they inline unless `MATERIALIZED`; in MySQL 8 they are supported; SQLite 3.8.3+.
- Window functions for rankings, running totals and deduplication:

```sql
SELECT *
FROM (
  SELECT o.*, row_number() OVER (PARTITION BY customer_id ORDER BY placed_at DESC) AS rn
  FROM orders o
) ranked
WHERE rn = 1;
```

- Aggregate with `GROUP BY` on every non-aggregated column (MySQL `ONLY_FULL_GROUP_BY` enforces this); `HAVING` filters aggregates, `WHERE` filters rows.
- Pagination: keyset (`WHERE (placed_at, id) < (?, ?) ORDER BY placed_at DESC, id DESC LIMIT 50`) over large `OFFSET`s.
- Upserts: PostgreSQL/SQLite `INSERT ... ON CONFLICT (key) DO UPDATE SET ...`; MySQL `INSERT ... ON DUPLICATE KEY UPDATE`.
- Returning data from writes: `RETURNING *` (PostgreSQL, SQLite 3.35+, MariaDB); MySQL needs a follow-up `SELECT` or `LAST_INSERT_ID()`.
- Always parameterise (`$1`, `?`, `:name`); never concatenate values into SQL. Use the driver's array/`ANY($1)` support for `IN` lists in PostgreSQL.
- Formatting: one clause per line, keywords consistently cased, aliases short but meaningful (`o`, `c`), `AS` for column aliases.

### Reading EXPLAIN

- PostgreSQL: `EXPLAIN (ANALYZE, BUFFERS) <query>`; look for `Seq Scan` on large tables, `Rows Removed by Filter`, estimated vs actual row counts (off by 10x or more means stale stats, run `ANALYZE table`), `Nested Loop` with large outer sets, `Sort` with `external merge` (raise `work_mem` or add an index), `Hash Join` memory spills.
- MySQL: `EXPLAIN FORMAT=TREE` / `EXPLAIN ANALYZE` (8.0.18+); watch `type: ALL` (full scan), `Using filesort`, `Using temporary`, `rows` estimates, `key: NULL`.
- SQLite: `EXPLAIN QUERY PLAN`; `SCAN table` means full scan, `SEARCH table USING INDEX` is good; `USE TEMP B-TREE FOR ORDER BY` indicates a missing index.
- Fix order: correct the predicate so it is sargable (no function on the indexed column, matching types), add/adjust an index, then rewrite the query. Re-run EXPLAIN after each change on production-like data volumes.

### Transactions and isolation

- Wrap multi-statement changes in a transaction; keep transactions short; never hold one open across network calls or user interaction.
- Default isolation: `READ COMMITTED` (PostgreSQL), `REPEATABLE READ` (MySQL InnoDB), serialisable per-connection (SQLite). Use `SELECT ... FOR UPDATE` (`FOR UPDATE SKIP LOCKED` for job queues) when reading-then-writing; or `SERIALIZABLE` with retry on serialisation failure.
- Deadlocks: acquire locks in a consistent order (e.g. by primary key ascending), batch updates, retry on deadlock errors (`40P01` PostgreSQL, `1213` MySQL).
- DDL: transactional in PostgreSQL and SQLite (can roll back), not in MySQL (each DDL commits implicitly). Plan MySQL migrations to be individually safe.

### Migrations

- One logical change per migration, forward-only in production; write the down migration only if the tool and team use them.
- Make schema changes backward compatible with the running application (expand/contract): add nullable column → backfill in batches → add `NOT NULL`/default → remove old column in a later release.
- Avoid long locks: in PostgreSQL adding a column with a constant default is instant (11+), but `ALTER COLUMN ... SET NOT NULL` scans; add a `CHECK (col IS NOT NULL) NOT VALID` then `VALIDATE CONSTRAINT`. Set `lock_timeout` in migration sessions. MySQL: prefer `ALGORITHM=INSTANT|INPLACE`; use `gh-ost`/`pt-online-schema-change` for big tables.
- Backfills: `UPDATE ... WHERE id BETWEEN ? AND ?` in batches with commits between, not one giant `UPDATE`.
- Never edit a migration that has run anywhere but your machine; add a new one.
- Keep a schema dump (`pg_dump --schema-only`, `structure.sql`) committed if the project does, and regenerate it with the tool.

## Common tasks

### Add a table

1. Create a migration via the project's tool (`alembic revision -m`, `rails g migration`, `npx prisma migrate dev`, `migrate create -ext sql`, ...).
2. Define columns with types, `NOT NULL`, defaults, PK, FKs with explicit `ON DELETE`, `CHECK`s, and `UNIQUE` constraints.
3. Add indexes for every FK and every anticipated filter/sort path.
4. Run the migration locally, then the application's tests; regenerate the committed schema snapshot if there is one.

### Add an index for a slow query

1. Capture the slow query and run `EXPLAIN (ANALYZE, BUFFERS)` (or the dialect equivalent).
2. Decide columns: equality predicates, then range/sort; consider partial or covering.
3. Create it `CONCURRENTLY`/online in a migration marked non-transactional if the tool supports it.
4. Re-run EXPLAIN; confirm the index is used and the plan cost/time dropped.

### Write a report query

Build incrementally: filter the smallest table first, join outward, aggregate last; use CTEs to name steps; verify counts at each step against a known subset; add `LIMIT` while iterating.

### Safely change a column type or rename

Rename: create the new column, dual-write from the app, backfill, switch reads, drop the old column (several deploys). Type widening (`int` → `bigint`) rewrites the table in PostgreSQL; do it via a new column + backfill on big tables.

### Seed data

Idempotent inserts: `INSERT ... ON CONFLICT DO NOTHING` (PostgreSQL/SQLite), `INSERT IGNORE` (MySQL). Keep seeds separate from migrations.

## Pitfalls

- `NULL` comparisons: `col = NULL` is never true; use `IS NULL`/`IS DISTINCT FROM` (PostgreSQL; MySQL `<=>`). `NOT IN (subquery)` returns nothing if the subquery has a NULL.
- Non-sargable predicates: `WHERE date(created_at) = '2024-01-01'` or `WHERE lower(email) = ?` without an expression index; `WHERE id = '123'` with type mismatch (MySQL casts and skips the index).
- Implicit N+1 from ORMs; batch with `IN (...)`/joins or eager loading.
- `OFFSET` pagination on large tables scans and discards rows; use keyset.
- `SELECT COUNT(*)` on huge tables for existence; use `EXISTS` or approximate counts (`pg_class.reltuples`).
- MySQL `utf8` is 3-byte; use `utf8mb4` with a `_0900_ai_ci` or `_bin` collation. Case-insensitive collations change uniqueness semantics.
- SQLite type affinity accepts any value in any column; enable `STRICT` tables (3.37+) and `PRAGMA foreign_keys = ON` (off by default).
- Time zones: store UTC (`timestamptz`), convert at the edge; MySQL `TIMESTAMP` depends on the session `time_zone`.
- `LIKE '%term%'` cannot use a B-tree index; use trigram (`pg_trgm`) or full-text search.
- Giant transactions that bloat WAL/undo logs and block vacuum/replication; batch.
- Running destructive statements without a `WHERE` or without a transaction/backup; in interactive sessions `BEGIN` first and check `SELECT count(*)` with the same predicate.

## Verification

```bash
# migrations
alembic upgrade head && alembic downgrade -1 && alembic upgrade head     # or the project's tool: rails db:migrate, prisma migrate dev, migrate up
# lint / format
sqlfluff lint --dialect postgres path/to/*.sql     # dialect from .sqlfluff
pg_format -i path/to/file.sql
# query check
psql "$DATABASE_URL" -c 'EXPLAIN (ANALYZE, BUFFERS) SELECT ...'
mysql -e 'EXPLAIN ANALYZE SELECT ...' db
sqlite3 app.db 'EXPLAIN QUERY PLAN SELECT ...'
# schema drift
pg_dump --schema-only "$DATABASE_URL" | diff - db/structure.sql
```

Run the application's integration tests against a real database (Docker service, `testcontainers`) rather than only unit tests with mocked repositories. Confirm the migration runs cleanly on a copy of production-sized data before release when it touches large tables.

## References

- PostgreSQL manual: https://www.postgresql.org/docs/current/
- PostgreSQL EXPLAIN: https://www.postgresql.org/docs/current/using-explain.html
- MySQL 8 reference: https://dev.mysql.com/doc/refman/8.0/en/
- MySQL EXPLAIN output: https://dev.mysql.com/doc/refman/8.0/en/explain-output.html
- SQLite documentation: https://www.sqlite.org/docs.html
- SQLite query planner: https://www.sqlite.org/eqp.html
- Use The Index, Luke (indexing guide): https://use-the-index-luke.com/
- PostgreSQL wiki, Don't Do This: https://wiki.postgresql.org/wiki/Don%27t_Do_This
- Strong migrations (safe migration patterns): https://github.com/ankane/strong_migrations
