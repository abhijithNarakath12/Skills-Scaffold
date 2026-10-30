# Eloquent performance

## Seeing the queries

```php
// AppServiceProvider::boot()
Model::shouldBeStrict(! $this->app->isProduction());  // preventLazyLoading + preventSilentlyDiscardingAttributes + preventAccessingMissingAttributes

DB::listen(fn ($q) => logger()->debug($q->sql, ['bindings' => $q->bindings, 'ms' => $q->time]));
Order::where(...)->toRawSql();        // 10+: SQL with bindings inlined
Order::where(...)->dd();  Order::where(...)->dumpRawSql();
```

- `barryvdh/laravel-debugbar` (web) or `laravel/telescope` show query counts and duplicates.
- Tests: `$this->expectsDatabaseQueryCount(3)` (10+).

## Eager loading

| Need | Code |
|---|---|
| Relations for a list | `Order::with(['customer', 'items.product'])->get()` |
| Constrained relation | `Order::with(['items' => fn ($q) => $q->where('active', true)->orderBy('position')])` |
| Only some columns | `Order::with('customer:id,name')` (always include the key columns) |
| Already-loaded models | `$orders->load('items')`, `$order->loadMissing('customer')` |
| Counts/sums/exists | `withCount('items')`, `withSum('items', 'total_cents')`, `withExists('refunds')`, `withMax(...)`, `withAvg(...)` |
| Filter by relation | `whereHas('items', fn ($q) => $q->where('sku', 'X'))`, `whereRelation('customer', 'vip', true)`, `whereBelongsTo($customer)` |
| Polymorphic | `with('commentable')`, `morphWith([Post::class => ['author']])` |
| Nested counts on relations | `with(['customer' => fn ($q) => $q->withCount('orders')])` |

Avoid `$with` on the model (always eager loads, even when unnecessary); prefer explicit `with()` per query, or `withoutRelations()`/`without()` when `$with` exists.

## Reading large sets

```php
Order::where('status', 'paid')->chunkById(1000, function ($orders) { ... });   // stable paging by id
Order::lazyById(1000)->each(fn ($o) => ...);                                     // LazyCollection, low memory
Order::query()->cursor();                                                        // one row at a time, still one query
Order::cursorPaginate(50);                                                       // keyset pagination for APIs
Order::simplePaginate(50);                                                       // no COUNT(*) query
```

`chunk()` with a `where` that the callback modifies skips rows; use `chunkById`.

## Writing efficiently

```php
Order::insert($rows);                                   // no events, no timestamps
Order::upsert($rows, ['reference'], ['total_cents']);   // unique by, columns to update
Order::whereIn('id', $ids)->update(['status' => 'archived']);
$order->increment('views');  $order->decrement('stock', 5);
DB::transaction(fn () => ..., attempts: 3);             // retry on deadlock
Order::whereKey($id)->lockForUpdate()->first();
```

Model events (`creating`, `saved`, observers) and `$casts` only run on model instances, not on query-builder bulk writes.

## Aggregates and raw expressions

```php
Order::selectRaw('status, COUNT(*) AS n, SUM(total_cents) AS cents')->groupBy('status')->get();
Order::where('total_cents', '>', DB::raw('expected_cents'))->get();
Order::orderByRaw('FIELD(status, ?, ?, ?)', ['paid', 'pending', 'shipped']);
Order::whereDate('created_at', today())->exists();   // beware: functions on columns defeat indexes; prefer whereBetween on ranges
```

Always bind user input (`?` placeholders or `DB::raw` with constants only).

## Indexing

- `foreignId()->constrained()` creates an index; add composite indexes for frequent filters: `$table->index(['customer_id', 'status']);`.
- `$table->unique(['team_id', 'reference']);`; partial/expression indexes via `DB::statement()` in the migration.
- Use `EXPLAIN` via `DB::select('EXPLAIN ' . $query->toRawSql())` or run in `php artisan db` / `tinker`.
- `ulid()`/`uuid()` primary keys: use `HasUlids` (time-ordered, index-friendly) over random UUID v4.

## Caching

```php
$stats = Cache::remember("team:{$team->id}:stats", now()->addMinutes(10), fn () => $this->compute($team));
Cache::forget("team:{$team->id}:stats");     // invalidate in an observer or action
Cache::flexible($key, [60, 300], fn () => ...);   // 11.23+: stale-while-revalidate
```

Prefer explicit invalidation in the action that changes the data; use `Cache::tags()` only with Redis/Memcached.

## Checklist for a slow endpoint

1. Count queries (Debugbar/`expectsDatabaseQueryCount`). More than ~10 for a list page is a smell.
2. Add eager loading and aggregate helpers; replace loops that call relations.
3. Select only needed columns for wide tables; paginate.
4. Check indexes with `EXPLAIN`; add composite indexes.
5. Cache computed values with explicit invalidation.
6. Move heavy work to a queued job and return early.
