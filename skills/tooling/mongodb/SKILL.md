---
name: mongodb
description: Use MongoDB 6/7 correctly from Node (Mongoose or the native driver), Python (pymongo, motor, beanie) and Go. Covers schema design (embedding vs referencing), indexes and ESR ordering, aggregation pipelines, multi-document transactions, Mongoose models and validation, pagination, and common query and performance mistakes. Use when a project depends on mongodb, mongoose, pymongo, motor, beanie or mongo-driver, or when designing collections or writing queries.
---

# MongoDB

Assumes MongoDB 6.0 or 7.0 (replica set or Atlas), Node driver 6.x / Mongoose 8.x, pymongo 4.x / motor 3.x, Go driver 1.x/2.x. Check `db.version()` in `mongosh` and the driver version in the lockfile.

## When to use

- Designing or changing collections, documents, indexes or Mongoose schemas.
- Writing find/update/aggregation queries, transactions, or pagination.
- Fixing slow queries, validation errors, connection issues, or data-shape bugs.

## Project conventions to detect first

1. Access layer: Mongoose (`models/*.ts`, `new Schema({...})`), native driver (`MongoClient`, `db.collection()`), Prisma with MongoDB, beanie/odmantic, mongoengine. Match it.
2. Connection: `MONGODB_URI`/`MONGO_URL`, single shared client (correct) vs per-request clients (bug), `dbName`, read/write concerns, `retryWrites`.
3. ID style: default `ObjectId` `_id` vs UUID/string IDs; timestamps (`{ timestamps: true }` in Mongoose, `createdAt`/`updatedAt` manual otherwise).
4. Index management: `schema.index()` + `autoIndex` (dev only), migration scripts, Atlas UI, or `createIndexes` on startup. Production should not rely on `autoIndex`.
5. Validation: Mongoose schema validators, JSON Schema `$jsonSchema` validator on the collection, or app-level (zod/pydantic).
6. Testing: `mongodb-memory-server`, testcontainers, a shared dev cluster; whether tests run against a replica set (needed for transactions and change streams).

## Core guidance

### Schema design

- Model for the queries you run, not for normalization. Data that is read together is stored together.
- Embed when the child belongs to exactly one parent, is bounded in size, and is read with the parent (address on a user, line items on an order).
- Reference when the child is shared, unbounded, or updated independently (comments on a popular post, products referenced by many orders). Store the referencing ID on the "many" side; avoid unbounded arrays of IDs on the "one" side.
- Document size limit is 16 MB; arrays that grow forever (logs, events) belong in their own collection or a bucket pattern.
- Common patterns: extended reference (copy a few fields of the referenced doc for display), bucket (time-series chunks), outlier (flag docs that exceed array limits), computed (store totals, update on write), schema versioning (`schemaVersion` field).
- Use native types: `Date` for dates (not strings), `Decimal128` for money, `ObjectId` for references, `Long`/`Int32` as appropriate; store dates in UTC.
- Field names are repeated in every document; keep them short but readable. Avoid dynamic field names as keys (use arrays of `{ key, value }` with a multikey index).
- Time-series data: use time-series collections (5.0+) `createCollection('metrics', { timeseries: { timeField: 't', metaField: 'm', granularity: 'seconds' } })`.

### Mongoose models

```ts
import { Schema, model, InferSchemaType } from 'mongoose';

const orderSchema = new Schema(
  {
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    status: { type: String, enum: ['pending', 'paid', 'shipped'], default: 'pending', required: true },
    items: [{ sku: { type: String, required: true }, qty: { type: Number, min: 1, required: true } }],
    totalCents: { type: Number, required: true, min: 0 },
  },
  { timestamps: true, strict: 'throw', optimisticConcurrency: true },
);
orderSchema.index({ customer: 1, createdAt: -1 });

export type Order = InferSchemaType<typeof orderSchema>;
export const OrderModel = model('Order', orderSchema);
```

- `strict: 'throw'` surfaces typos; `strictQuery` default changed across versions, set it explicitly.
- Validation runs on `save()`/`create()`; for `updateOne`/`findOneAndUpdate` pass `{ runValidators: true }`. `findOneAndUpdate` returns the old doc unless `{ new: true }` (or `returnDocument: 'after'`).
- Use `.lean()` for read-only queries (plain objects, 3-5x faster); use hydrated docs only when you need methods/middleware.
- `populate()` is a second query per path; limit with `select`, or denormalize with the extended reference pattern. Avoid deep/nested populate in hot paths.
- Middleware (`pre('save')`) does not run on `updateMany`/`insertMany` the same way; check which hooks fire for which operations.
- Set `autoIndex: false` in production and manage indexes explicitly (`Model.syncIndexes()` in a migration step, with review of dropped indexes).

### Indexes

- Default `_id` index only; every query pattern needs a supporting index. Follow the ESR rule for compound indexes: Equality fields, then Sort fields, then Range fields.
- `{ customer: 1, createdAt: -1 }` serves `find({ customer }).sort({ createdAt: -1 })`; a `{ createdAt: -1 }` index alone does not help that query much.
- Multikey indexes on array fields; only one array field per compound index.
- Partial indexes (`partialFilterExpression`) for sparse subsets; unique + partial for "unique when present"; TTL indexes (`expireAfterSeconds`) for sessions/tokens.
- Text search: Atlas Search for anything serious; `text` index for simple cases (one per collection).
- Build indexes in the background (default since 4.2) but still during low traffic on large collections; check `db.collection.getIndexes()` and drop unused ones using `$indexStats`.
- Covered queries: project only indexed fields and exclude `_id` if it is not in the index.

### Queries and updates

- Always use update operators (`$set`, `$inc`, `$push`, `$addToSet`, `$pull`); never replace whole documents to change one field.
- `findOneAndUpdate` with `upsert: true` for idempotent writes; `$setOnInsert` for insert-only fields.
- Array updates: positional `$` for the first match, `$[]` for all, `$[elem]` with `arrayFilters` for conditional.
- Bulk: `bulkWrite([{ updateOne: {...} }, ...], { ordered: false })` instead of loops; `insertMany` for batches.
- Projection to limit fields; `limit()` always on list endpoints.
- Pagination: range/keyset (`{ _id: { $gt: lastId } }` or `{ createdAt: { $lt: last }, _id: ... }` sorted the same way) instead of `skip()` on large offsets.
- `countDocuments(filter)` for exact counts (scans), `estimatedDocumentCount()` for whole-collection estimates.
- Regex without an anchored prefix (`/^abc/`) cannot use an index; case-insensitive regex needs a collation or a normalized field.

### Aggregation

```js
db.orders.aggregate([
  { $match: { status: 'paid', createdAt: { $gte: ISODate('2025-01-01') } } },   // first: uses indexes
  { $group: { _id: '$customer', total: { $sum: '$totalCents' }, n: { $sum: 1 } } },
  { $sort: { total: -1 } },
  { $limit: 20 },
  { $lookup: { from: 'customers', localField: '_id', foreignField: '_id', as: 'customer' } },
  { $unwind: '$customer' },
  { $project: { _id: 0, customerId: '$_id', name: '$customer.name', total: 1, n: 1 } },
]);
```

- `$match` and `$sort` early so they use indexes; `$limit` before `$lookup`; `$project`/`$unset` to shrink documents before memory-heavy stages.
- `$lookup` is a join; keep it off hot paths or denormalize. Use the pipeline form with `let`/`pipeline` for filtered lookups.
- `allowDiskUse: true` for large `$group`/`$sort` (100 MB stage limit). `$merge`/`$out` to materialize results.
- `$facet` for multi-aggregations in one pass (counts + page), `$bucket`/`$dateTrunc` for histograms and time grouping.
- `explain('executionStats')` on the aggregation to confirm `IXSCAN` in the first stage.

### Transactions

```ts
const session = client.startSession();
try {
  await session.withTransaction(async () => {
    await orders.insertOne(order, { session });
    await inventory.updateOne({ sku }, { $inc: { qty: -1 } }, { session });
  });
} finally {
  await session.endSession();
}
```

- Require a replica set (single-node replica set locally: `--replSet rs0` + `rs.initiate()`; `mongodb-memory-server` `MongoMemoryReplSet`). Mongoose: pass `{ session }` to every operation.
- Prefer single-document atomicity (embed what must change together) over transactions; transactions have a 60s default limit and add contention.
- Retry on `TransientTransactionError`/`UnknownTransactionCommitResult` labels; `withTransaction` does this for you.

## Common tasks

### Add a collection or model

1. Sketch the main read queries; decide embed vs reference per field.
2. Define the schema (Mongoose/beanie/JSON Schema) with required fields, enums, and `timestamps`.
3. Declare indexes matching the queries (ESR); add a migration or startup `syncIndexes`/`createIndexes` step.
4. Write a repository/service with typed queries; add tests against a real MongoDB (memory server or container).

### Optimize a slow query

1. Capture it from the profiler (`db.setProfilingLevel(1, { slowms: 100 })`, `db.system.profile.find().sort({ ts: -1 })`) or Atlas Performance Advisor.
2. `db.coll.find(filter).sort(sort).explain('executionStats')`: look for `COLLSCAN`, `totalDocsExamined` far above `nReturned`, in-memory `SORT` stage.
3. Add or reorder a compound index per ESR; add projection; replace `skip` with keyset.
4. Re-run explain; confirm `IXSCAN` and examined/returned ratio near 1.

### Local setup and shell

```bash
docker run -d --name mongo -p 27017:27017 mongo:7 --replSet rs0
docker exec mongo mongosh --eval 'rs.initiate()'
mongosh "mongodb://localhost:27017/app"
```

```js
show dbs; use app; show collections
db.orders.find({ status: 'paid' }).limit(5).pretty()
db.orders.getIndexes()
db.orders.aggregate([{ $indexStats: {} }])
db.currentOp({ secs_running: { $gt: 5 } })
```

### Write a data migration

- Use `migrate-mongo`, `mongock`, or a versioned script; make it idempotent (`$exists` checks, `schemaVersion` field) and batch with `bulkWrite` over cursors (`batchSize`), never load the whole collection into memory.

## Pitfalls

- Creating a `MongoClient` per request exhausts connections; create one client at startup and reuse it.
- Unbounded arrays (`$push` without `$slice`) hit the 16 MB limit and degrade performance long before that.
- `skip()` for deep pagination scans and discards; use range queries.
- Querying by string when the field is `ObjectId` (or vice versa) silently returns nothing; convert with `new ObjectId(id)` and validate input.
- `findOneAndUpdate` without `returnDocument: 'after'` returns the stale document.
- Mongoose `updateOne` skipping validators and defaults; pass `runValidators: true` or use `save()`.
- Case-insensitive lookups via `$regex: 'i'` on large collections; store a normalized lowercase field with an index, or use a collation index.
- `$where` and JavaScript in queries: slow and unsafe; use operators or aggregation.
- `autoIndex: true` in production builds indexes at boot on huge collections; manage explicitly.
- Writing with `w: 0` or reading from secondaries without accepting staleness.
- Running transactions on a standalone server (`Transaction numbers are only allowed on a replica set member`).
- Relying on field order in documents or `$natural` ordering for results; always sort explicitly.

## Verification

```bash
npm test / pytest / go test            # integration tests against a real MongoDB (memory server or container)
mongosh "$MONGODB_URI" --eval 'db.<coll>.getIndexes()'                 # indexes exist as planned
mongosh "$MONGODB_URI" --eval 'db.<coll>.find(<filter>).explain("executionStats").executionStats'   # IXSCAN, low docsExamined
npx tsc --noEmit                        # Mongoose types line up with usage
```

## References

- MongoDB manual: https://www.mongodb.com/docs/manual/
- Data modeling: https://www.mongodb.com/docs/manual/data-modeling/
- Schema design patterns: https://www.mongodb.com/blog/post/building-with-patterns-a-summary
- Indexes and the ESR rule: https://www.mongodb.com/docs/manual/tutorial/equality-sort-range-rule/
- Aggregation pipeline: https://www.mongodb.com/docs/manual/core/aggregation-pipeline/
- Transactions: https://www.mongodb.com/docs/manual/core/transactions/
- Node driver: https://www.mongodb.com/docs/drivers/node/current/
- Mongoose docs: https://mongoosejs.com/docs/guide.html
- PyMongo / Motor: https://pymongo.readthedocs.io/ and https://motor.readthedocs.io/
