---
name: prisma
description: Model, migrate and query databases with Prisma ORM 5/6 - schema.prisma modelling, prisma migrate dev/deploy, Prisma Client usage, relations, transactions, avoiding N+1 with select/include, seeding, and testing strategies. Load when a project depends on prisma or @prisma/client, contains schema.prisma, or when writing database access code with the Prisma Client.
---

# Prisma ORM

Assumes Prisma 5 or 6 (`prisma` CLI + `@prisma/client`), TypeScript, and a relational database (PostgreSQL, MySQL, SQLite, SQL Server, CockroachDB) or MongoDB. Check the version before using newer features.

## When to use

- Adding or changing models, fields, relations, indexes or enums in `schema.prisma`.
- Creating and applying migrations, seeding, or resetting databases.
- Writing queries, transactions, pagination, or fixing N+1 and over-fetching.
- Setting up Prisma in tests or CI.

## Project conventions to detect first

1. Versions: `prisma` and `@prisma/client` in `package.json` must match. Prisma 6 raised minimums to Node 18.18+ and TypeScript 5.1+; Prisma 5 dropped the `rejectOnNotFound` option (use `findUniqueOrThrow`).
2. Schema location: default `prisma/schema.prisma`; `prisma.config.ts` (Prisma 6.x, early access) or `"prisma": { "schema": "..." }` in `package.json` can override. Prisma 6 also supports a multi-file schema folder (`prisma/schema/*.prisma`).
3. Datasource and env: `DATABASE_URL` in `.env` (and `DIRECT_URL` when using a pooler such as PgBouncer/Accelerate/Neon). Never commit real credentials.
4. Generator: `provider = "prisma-client-js"` (classic) or `"prisma-client"` (new ESM-first generator with required `output`, Prisma 6.6+). Check whether `output` is set; the generated client lives there instead of `node_modules/.prisma/client`.
5. Client instantiation: a singleton module (`lib/prisma.ts` or `db.ts`) guarding against hot-reload duplicates in dev. Reuse it; never `new PrismaClient()` per request.
6. Extensions: `prisma.$extends(...)` for soft-delete, computed fields, or `@prisma/extension-accelerate`. Driver adapters (`@prisma/adapter-pg`, `@prisma/adapter-libsql`, `@prisma/adapter-d1`) with `previewFeatures = ["driverAdapters"]` on Prisma 5; built in on 6.
7. Migration workflow: `prisma/migrations/` committed means `migrate`; no folder and `db push` in scripts means prototyping without migrations.
8. Seeding: `"prisma": { "seed": "tsx prisma/seed.ts" }` in `package.json`.

## Core guidance

### Schema modelling

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  role      Role     @default(USER)
  posts     Post[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  published Boolean  @default(false)
  author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
  authorId  String
  tags      Tag[]

  @@index([authorId, published])
  @@map("posts")
}

model Tag {
  id    Int    @id @default(autoincrement())
  name  String @unique
  posts Post[]
}

enum Role {
  USER
  ADMIN
}
```

- Every relation has a scalar foreign-key field plus a relation field; the other side holds the list. Implicit many-to-many (`Post[]`/`Tag[]`) is fine unless the join table needs extra columns, then model it explicitly with a composite `@@id([postId, tagId])`.
- Always set `onDelete` explicitly on required relations (`Cascade`, `SetNull`, `Restrict`). The default is `Restrict` for required relations on most databases, which fails deletes silently in app logic.
- Add `@@index` for columns used in `where`/`orderBy` and for every foreign key on PostgreSQL (MySQL creates them automatically).
- Use `@map`/`@@map` to keep snake_case tables with camelCase model fields.
- `Decimal` for money, `BigInt` for 64-bit ints, `Json` for unstructured data, `DateTime` stored as UTC.
- Run `npx prisma format` after editing; it also fills in missing back-relations.

### Client usage

```ts
// lib/prisma.ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ log: ['warn', 'error'] });
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

- `findUnique` needs a unique field; `findFirst` for anything else; `*OrThrow` variants raise `PrismaClientKnownRequestError` code `P2025` instead of returning `null`.
- Select only what is needed: `select` returns a narrow object; `include` adds relations. Never return whole `User` rows with password hashes to the API layer.
- Type query results with the generated helpers: `Prisma.UserGetPayload<{ include: { posts: true } }>` or `Prisma.validator`. Avoid redefining DTO types by hand.
- Filtering: `where: { email: { contains: q, mode: 'insensitive' } }`, relation filters `posts: { some: { published: true } }`, `AND`/`OR`/`NOT` arrays.
- Pagination: cursor-based (`cursor: { id }, skip: 1, take: 20, orderBy: { id: 'asc' }`) for infinite lists; `skip`/`take` only for small tables.
- Nested writes: `create: { posts: { create: [...] } }`, `connect: { id }`, `connectOrCreate`, `upsert`. They run in one transaction.
- Handle known errors by code: `P2002` unique violation, `P2025` not found, `P2003` foreign-key failure. Check `error instanceof Prisma.PrismaClientKnownRequestError`.

### Transactions

```ts
// interactive transaction: use when later statements depend on earlier results
await prisma.$transaction(async (tx) => {
  const from = await tx.account.update({ where: { id: a }, data: { balance: { decrement: amount } } });
  if (from.balance < 0) throw new Error('insufficient funds'); // rolls back
  await tx.account.update({ where: { id: b }, data: { balance: { increment: amount } } });
}, { isolationLevel: 'Serializable', timeout: 10_000 });

// batch: independent writes, all-or-nothing
await prisma.$transaction([prisma.post.deleteMany({ where: { authorId } }), prisma.user.delete({ where: { id: authorId } })]);
```

- Inside interactive transactions use `tx`, never the outer `prisma`; the outer client runs outside the transaction.
- Keep interactive transactions short (default timeout 5 s); do not call external APIs inside them.
- Atomic counters: `{ increment: 1 }` instead of read-modify-write.

### N+1 and loading

- Loading relations in a loop (`for (const post of posts) await prisma.user.findUnique(...)`) is the classic N+1. Use `include`/`select` in the parent query, or batch with `findMany({ where: { id: { in: ids } } })`.
- Prisma's query engine batches `findUnique` calls issued in the same tick (dataloader behaviour), which helps GraphQL resolvers, but explicit `include` is clearer.
- Relation counts: `_count: { select: { posts: true } }`; aggregates: `aggregate`, `groupBy`.
- Use `relationLoadStrategy: 'join'` (Prisma 5.9+ preview `relationJoins`, GA in 6.x for PostgreSQL/MySQL) when a single SQL join is cheaper than the default per-table queries; benchmark first.
- Raw SQL when the query builder cannot express it: `prisma.$queryRaw\`SELECT ... WHERE id = ${id}\`` (tagged template is parameterized). `$queryRawUnsafe` only with constants. Prisma 5.19+ `typedSql` (`prisma/sql/*.sql` + `--sql` flag) gives typed raw queries.

### Migrations

- Development: edit the schema, run `npx prisma migrate dev --name add_post_tags`. It creates `prisma/migrations/<timestamp>_add_post_tags/migration.sql`, applies it, and regenerates the client. Review the SQL before committing.
- Production/CI: `npx prisma migrate deploy` (applies pending migrations, never generates or resets). Run it in the deploy pipeline before starting the new app version.
- `npx prisma db push` syncs schema without migration files; only for prototypes or MongoDB.
- Data migrations (backfills) go in the generated `migration.sql` as additional statements, or as a separate migration created with `--create-only` and then edited.
- Destructive changes (renaming a column) are generated as drop+add. Edit the SQL to `ALTER TABLE ... RENAME COLUMN` before applying, or use `@map` to keep the DB name.
- Never edit an applied migration; create a new one. Resolve a failed production migration with `prisma migrate resolve --applied|--rolled-back <name>`.
- `prisma migrate reset` drops the database (dev only); it runs the seed afterwards.

### Seeding

```ts
// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  await prisma.user.upsert({ where: { email: 'admin@example.com' }, update: {}, create: { email: 'admin@example.com', role: 'ADMIN' } });
}
main().finally(() => prisma.$disconnect());
```

`package.json`: `"prisma": { "seed": "tsx prisma/seed.ts" }`; run with `npx prisma db seed`. Seeds must be idempotent (`upsert`, `createMany({ skipDuplicates: true })`).

## Common tasks

### Add a model or field

1. Edit `schema.prisma`; run `npx prisma format`.
2. `npx prisma migrate dev --name <change>`; inspect the SQL.
3. `npx prisma generate` if the client was not regenerated (migrate dev does it).
4. Update the code that creates records (required fields without defaults break existing `create` calls; add a default or make it optional).

### Add a required column to a populated table

1. Add the field as optional or with `@default`, migrate.
2. Backfill data (SQL inside the migration or a script).
3. Make it required in a second migration.

### Query with relations

```ts
const posts = await prisma.post.findMany({
  where: { published: true, author: { role: 'ADMIN' } },
  select: { id: true, title: true, author: { select: { id: true, email: true } }, _count: { select: { tags: true } } },
  orderBy: { createdAt: 'desc' },
  take: 20,
});
```

### Set up tests

- Integration tests against a real database are the reliable option: a Docker PostgreSQL (`testcontainers` or `docker compose`), `DATABASE_URL` pointing at a test DB, `prisma migrate deploy` (or `db push --force-reset` for speed) in global setup, and truncate tables between tests (`prisma.$executeRawUnsafe('TRUNCATE "User", "Post" CASCADE')`) or wrap each test in a transaction with a helper such as `@chax-at/transactional-prisma-testing`.
- SQLite file/in-memory DB for fast tests only if the production provider is SQLite; provider-specific SQL (`mode: 'insensitive'`, enums, `Json` filters) differs.
- Unit tests of service code: inject the client and mock it with `vitest-mock-extended` / `jest-mock-extended` (`mockDeep<PrismaClient>()`). Do not mock in integration tests.
- Never run tests against the dev database that `migrate dev` manages.

### Introspect an existing database

`npx prisma db pull` writes models from the live schema; then `npx prisma generate`. Use `migrate dev` afterwards only after creating a baseline migration (`migrate diff --from-empty --to-schema-datamodel ... --script > prisma/migrations/0_init/migration.sql` and `migrate resolve --applied 0_init`).

## Pitfalls

- Multiple `PrismaClient` instances (one per request or per module) exhausting connection pools, especially in serverless; use the singleton and a pooler (`pgbouncer=true` in the URL, or Accelerate) when deploying to lambdas/edge.
- Forgetting `prisma generate` after schema changes or in Docker builds (the generated client must be built in the image: run `npx prisma generate` in the Dockerfile and copy `node_modules/.prisma`).
- `migrate dev` in production or CI; it may reset the database when drift is detected. Use `migrate deploy`.
- Returning `include`d relations to clients and leaking sensitive fields; prefer `select` or omit fields with `omit` (Prisma 5.16+ preview, GA in 6.x: `omit: { password: true }`).
- `findMany` with no `take` on large tables.
- Floating-point arithmetic on `Decimal` results; use `Prisma.Decimal` methods or `decimal.js`.
- `DateTime` timezone confusion: Prisma stores and returns UTC `Date` objects; convert at the edge.
- Long-running interactive transactions holding locks, or awaiting `prisma.*` (not `tx.*`) inside them.
- `@default(uuid())`/`cuid()` are generated client-side; use `@default(dbgenerated("gen_random_uuid()"))` when the database must generate ids (raw inserts, other services).
- Enum changes on PostgreSQL require manual SQL for removing values; adding is fine.
- Implicit many-to-many tables named `_PostToTag` cannot carry extra columns; convert to an explicit model before needing them.

## Verification

```bash
npx prisma validate                 # schema syntax and relation checks
npx prisma format --check 2>/dev/null || npx prisma format   # formatting (check flag exists on newer versions)
npx prisma migrate status           # pending/failed migrations against DATABASE_URL
npx prisma generate && npx tsc --noEmit
npm test                            # integration tests against a disposable DB
npx prisma studio                   # manual data inspection
```

## References

- Prisma docs: https://www.prisma.io/docs
- Schema reference: https://www.prisma.io/docs/orm/reference/prisma-schema-reference
- Client API reference: https://www.prisma.io/docs/orm/reference/prisma-client-reference
- Migrations in production: https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production
- Error codes: https://www.prisma.io/docs/orm/reference/error-reference
- Upgrade guides (v5, v6): https://www.prisma.io/docs/orm/more/upgrade-guides
