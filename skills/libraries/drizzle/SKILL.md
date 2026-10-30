---
name: drizzle
description: Build type-safe database access with Drizzle ORM - schema definition per dialect (pg/mysql/sqlite), drizzle-kit generate/migrate/push, the SQL-like query builder vs relational queries (db.query), transactions, and type inference with $inferSelect/$inferInsert. Load when a project depends on drizzle-orm or drizzle-kit, contains drizzle.config.ts, or when writing queries or migrations with Drizzle.
---

# Drizzle ORM

Assumes `drizzle-orm` 0.30+ and `drizzle-kit` 0.20+ with TypeScript. Commands and APIs below are current for drizzle-kit 0.2x/0.3x; verify flags with `npx drizzle-kit --help` because the CLI changed several times.

## When to use

- Defining or changing tables, columns, indexes, relations, or enums in Drizzle schema files.
- Generating and applying migrations, pushing schema in development, or introspecting an existing DB.
- Writing selects, inserts, updates, joins, relational queries, or transactions.
- Choosing a driver (node-postgres, postgres.js, Neon, PlanetScale, better-sqlite3, libsql/Turso, D1, Bun SQLite).

## Project conventions to detect first

1. Dialect and driver: `drizzle.config.ts` has `dialect: 'postgresql' | 'mysql' | 'sqlite' | 'turso' | 'singlestore'` and `dbCredentials`. The `db` instance file (`src/db/index.ts`, `lib/db.ts`) shows the driver import: `drizzle-orm/node-postgres`, `drizzle-orm/postgres-js`, `drizzle-orm/neon-http`, `drizzle-orm/better-sqlite3`, `drizzle-orm/libsql`, `drizzle-orm/d1`, `drizzle-orm/mysql2`.
2. Schema layout: single `schema.ts` or a folder (`src/db/schema/*.ts`) referenced via `schema: './src/db/schema'` (folder or glob) in the config. Relations may live next to tables or in `relations.ts`.
3. Migration strategy: `out: './drizzle'` folder with `*.sql` + `meta/_journal.json` means `generate` + `migrate`; no folder and `drizzle-kit push` in scripts means push-only (dev/prototypes, D1/Turso often).
4. Relational queries: `drizzle(client, { schema })` is required for `db.query.<table>` to work; if `schema` is not passed, only the query builder is available.
5. Casing: `casing: 'snake_case'` in both config and `drizzle()` options lets you write camelCase TS names and get snake_case columns without per-column names.
6. Validation integration: `drizzle-zod`, `drizzle-typebox`, `drizzle-valibot` (`createInsertSchema`, `createSelectSchema`).
7. Scripts: `package.json` scripts such as `db:generate`, `db:migrate`, `db:push`, `db:studio`.

## Core guidance

### Schema definition

```ts
// src/db/schema.ts (PostgreSQL)
import { pgTable, serial, text, integer, boolean, timestamp, index, pgEnum } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

export const roleEnum = pgEnum('role', ['user', 'admin']);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  role: roleEnum('role').notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const posts = pgTable(
  'posts',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    published: boolean('published').notNull().default(false),
    authorId: integer('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    updatedAt: timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index('posts_author_idx').on(t.authorId, t.published)],
);

export const usersRelations = relations(users, ({ many }) => ({ posts: many(posts) }));
export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

- The third `pgTable` argument returns an array of indexes/constraints (older versions used an object; both still work, the array form is current).
- Dialect imports differ: `mysqlTable`/`int`/`varchar` from `drizzle-orm/mysql-core`; `sqliteTable`/`integer`/`text` from `drizzle-orm/sqlite-core` (timestamps are `integer('x', { mode: 'timestamp' })`, booleans `integer('x', { mode: 'boolean' })`).
- `relations()` is for the relational query API only; it does not create foreign keys. `references()` creates the FK. Define both.
- Many-to-many needs an explicit join table with a composite `primaryKey({ columns: [t.a, t.b] })` and `relations` on all three tables.
- Defaults: `.default(value)` becomes a DB default; `.$defaultFn(() => crypto.randomUUID())` runs in JS on insert; `.$onUpdate()` runs on update via Drizzle only.
- JSON columns: `jsonb('meta').$type<Meta>()` for typing.
- Export every table and relation from the schema module(s) passed to `drizzle()`; unexported tables are invisible to drizzle-kit and `db.query`.

### Query builder (SQL-like)

```ts
import { eq, and, desc, ilike, inArray, count, sql } from 'drizzle-orm';

const rows = await db
  .select({ id: posts.id, title: posts.title, authorEmail: users.email })
  .from(posts)
  .innerJoin(users, eq(posts.authorId, users.id))
  .where(and(eq(posts.published, true), ilike(posts.title, `%${q}%`)))
  .orderBy(desc(posts.id))
  .limit(20);

const [created] = await db.insert(users).values({ email }).returning({ id: users.id });   // pg/sqlite; mysql has no returning
await db.update(posts).set({ published: true }).where(inArray(posts.id, ids));
await db.delete(posts).where(eq(posts.id, id));
await db.insert(users).values({ email }).onConflictDoUpdate({ target: users.email, set: { role: 'admin' } });
const [{ total }] = await db.select({ total: count() }).from(posts);
```

- Joins return nested objects keyed by table when you `select()` without a projection (`{ posts: {...}, users: {...} }`); with a projection you get a flat row. Left joins make the right side nullable.
- Build dynamic filters with an array of conditions and `and(...conds)`; `and()` ignores `undefined` entries.
- `sql` template for anything the builder lacks: ``sql`lower(${users.email})` ``; it is parameterized. Use `sql.raw` only for identifiers/constants you control.
- Prepared statements for hot paths: `db.select().from(users).where(eq(users.id, sql.placeholder('id'))).prepare('user_by_id')` then `.execute({ id })`.
- `db.$count(posts, eq(posts.published, true))` is the shorthand count helper on recent versions.

### Relational queries

```ts
const result = await db.query.users.findMany({
  where: eq(users.role, 'admin'),
  columns: { id: true, email: true },
  with: { posts: { where: eq(posts.published, true), orderBy: desc(posts.id), limit: 5 } },
  limit: 10,
});
// result[0].posts is typed from the relations
```

- Use relational queries for reading nested data (one round trip, no manual join mapping); use the query builder for joins with aggregation, updates, bulk operations, and anything needing `GROUP BY`.
- `where` in `with` filters the related rows, not the parent. Filtering parents by related rows needs `exists` with a subquery or the query builder.
- `extras: { fullName: sql<string>\`...\`.as('full_name') }` adds computed columns.

### Transactions

```ts
await db.transaction(async (tx) => {
  const [acct] = await tx.select().from(accounts).where(eq(accounts.id, id)).for('update');
  if (acct.balance < amount) tx.rollback();                       // throws, rolls back
  await tx.update(accounts).set({ balance: sql`${accounts.balance} - ${amount}` }).where(eq(accounts.id, id));
}, { isolationLevel: 'serializable' });
```

- Use `tx`, not `db`, inside the callback. Nested `tx.transaction()` creates savepoints.
- HTTP drivers (`neon-http`, `planetscale` HTTP) do not support interactive transactions; use `db.batch([...])` where available or the websocket/TCP driver.
- `db.batch()` (SQLite/libsql/D1/Neon) runs statements atomically in one round trip.

### Type inference

- `typeof table.$inferSelect` / `$inferInsert` (or `InferSelectModel<typeof table>`) for row types; never hand-write them.
- Relational query results: `Awaited<ReturnType<typeof getUsers>>` or `InferResultType` patterns from the docs.
- `drizzle-zod`: `createInsertSchema(users, { email: (s) => s.email() })` to validate request bodies against the table shape.

## Common tasks

### Set up Drizzle (PostgreSQL + node-postgres)

```bash
npm i drizzle-orm pg && npm i -D drizzle-kit @types/pg
```

```ts
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL! },
  casing: 'snake_case',
});
```

```ts
// src/db/index.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
export const db = drizzle(process.env.DATABASE_URL!, { schema, casing: 'snake_case' });
```

### Change the schema with migrations

1. Edit the schema file(s).
2. `npx drizzle-kit generate` (add `--name add_posts` for a readable file name). Review `drizzle/0001_*.sql`.
3. Apply: `npx drizzle-kit migrate` (reads `drizzle.config.ts`), or at app start with the programmatic migrator for the driver: `import { migrate } from 'drizzle-orm/node-postgres/migrator'; await migrate(db, { migrationsFolder: './drizzle' });`.
4. Commit the SQL and `drizzle/meta/*` together; never edit `_journal.json` by hand.
5. Custom SQL (data backfills, extensions, views): `npx drizzle-kit generate --custom --name backfill_roles` creates an empty migration to fill in.

### Prototype without migrations

`npx drizzle-kit push` diffs the schema against the live DB and applies it interactively (asks before destructive changes). Do not mix `push` with `generate`/`migrate` on the same database; drift makes later migrations fail.

### Adopt an existing database

`npx drizzle-kit pull` writes `schema.ts` and `relations.ts` into `out`; move them into the source tree, then `generate` a baseline and mark it applied (run `drizzle-kit migrate` against a DB that already has the tables will fail; insert the journal row manually or start with `push`).

### Avoid N+1

- Use `with` in relational queries or a join; never loop `await db.query.x.findFirst` per parent row.
- For many parents, batch with `inArray(table.parentId, ids)` and group in memory.

### Seed data

A plain script `src/db/seed.ts` run with `tsx`, using `db.insert(...).values([...]).onConflictDoNothing()`. `drizzle-seed` (`npm i -D drizzle-seed`) generates deterministic fake data: `await seed(db, schema).refine(...)`.

## Pitfalls

- Passing no `schema` to `drizzle()` and then calling `db.query.users`: it is `undefined` at runtime with a confusing error.
- Declaring `relations()` without `.references()` (no FK in the database) or the reverse (FK but relational queries cannot traverse).
- `casing: 'snake_case'` set in `drizzle.config.ts` but not in `drizzle()` (or vice versa); migrations and runtime disagree on column names.
- `.returning()` on MySQL (unsupported); use `$returningId()` or re-select.
- SQLite booleans/dates stored as integers; forgetting `{ mode: 'boolean' | 'timestamp' }` yields numbers.
- Serverless/edge: TCP drivers (`pg`, `mysql2`) do not run on edge runtimes; use the HTTP driver for Neon/PlanetScale/Turso/D1.
- `drizzle-kit push` on production data; it can drop columns after an interactive prompt that CI auto-accepts. Use `generate` + `migrate`.
- Using `db` instead of `tx` inside `db.transaction`.
- `where: and(cond1, cond2)` where both are `undefined` yields no filter: updates/deletes affect every row. Guard bulk writes.
- Timestamps without `withTimezone: true` on PostgreSQL silently drop offsets.
- Old tutorials: `drizzle-kit generate:pg`, `driver: 'pg'` and `connectionString` are pre-0.21 syntax; current config uses `dialect` and `dbCredentials.url`.

## Verification

```bash
npx drizzle-kit check          # migration folder consistency (journal vs snapshots)
npx drizzle-kit generate       # should report "No schema changes" when schema and migrations agree
npx tsc --noEmit
npm test                       # integration tests against a disposable DB (Docker/testcontainers or in-memory SQLite when the dialect is sqlite)
npx drizzle-kit studio         # browse data at local.drizzle.studio
```

## References

- Drizzle docs: https://orm.drizzle.team/docs/overview
- drizzle-kit commands: https://orm.drizzle.team/docs/kit-overview
- Relational queries: https://orm.drizzle.team/docs/rqb
- Column types per dialect: https://orm.drizzle.team/docs/column-types/pg
- Drizzle with serverless drivers: https://orm.drizzle.team/docs/connect-overview
