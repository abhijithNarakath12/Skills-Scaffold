# Django ORM performance patterns

## Diagnosing

```python
from django.db import connection, reset_queries
from django.test.utils import CaptureQueriesContext

with CaptureQueriesContext(connection) as ctx:
    list(view_queryset())
print(len(ctx.captured_queries)); print(ctx.captured_queries[-1]["sql"])
```

- Tests: `self.assertNumQueries(n)` or pytest-django `django_assert_num_queries(n)` / `django_assert_max_num_queries(n)`.
- Dev: `django-debug-toolbar` SQL panel (duplicate query highlighting), `django-silk`, or `nplusone`.
- Log all SQL temporarily: `LOGGING = {"loggers": {"django.db.backends": {"level": "DEBUG", "handlers": ["console"]}}}` with `DEBUG=True`.
- Print the SQL of a queryset: `str(qs.query)` or `qs.explain()`.

## Fixing N+1

| Access pattern | Fix |
|---|---|
| `order.customer` in a loop (FK, O2O) | `Order.objects.select_related("customer", "customer__account")` |
| `order.items.all()` in a loop (reverse FK, M2M) | `prefetch_related("items")` |
| Nested: each item's product | `prefetch_related("items__product")` or `Prefetch("items", queryset=Item.objects.select_related("product"))` |
| Filtered related set | `Prefetch("items", queryset=Item.objects.filter(active=True), to_attr="active_items")` then use `order.active_items` |
| Count of related | `annotate(item_count=Count("items"))` instead of `order.items.count()` |
| Existence of related | `annotate(has_items=Exists(Item.objects.filter(order=OuterRef("pk"))))` |
| Latest related row | `Subquery(Item.objects.filter(order=OuterRef("pk")).order_by("-created").values("price")[:1])` |
| Generic FK | `prefetch_related("content_object")` (one query per content type) |

Rules:

- Calling `.filter()`/`.order_by()` on a prefetched manager (`order.items.filter(...)`) discards the prefetch and queries again. Filter in Python over `order.items.all()`, or use `Prefetch(...)` with the filter and `to_attr`.
- `prefetch_related_objects(instances, "items")` when you already have a list.
- DRF: do optimization in `get_queryset`; for conditional fields use separate serializers rather than skipping fields at runtime.

## Reducing data and round trips

- `only("id", "status")` / `defer("body")` for wide tables; accessing a deferred field triggers a query per instance.
- `values()`/`values_list()` for reports and exports.
- `iterator(chunk_size=2000)` to stream large result sets (combine with `prefetch_related` only on Django 4.1+).
- `bulk_create(objs, batch_size=1000, ignore_conflicts=True|update_conflicts=True, update_fields=[...], unique_fields=[...])` for upserts (Django 4.1+ for `update_conflicts`).
- `bulk_update(objs, ["field"], batch_size=500)`; `QuerySet.update(field=F("field") + 1)` for atomic increments.
- `in_bulk(ids)` returns a dict keyed by pk.

## Indexing and constraints

- `db_index=True` on FKs is automatic; add indexes for filter/order columns used together: `models.Index(fields=["customer", "-created_at"])`.
- Partial and expression indexes: `models.Index(fields=["email"], condition=Q(active=True), name="active_email_idx")`, `models.Index(Lower("email"), name="email_lower_idx")`.
- `UniqueConstraint(fields=[...], condition=...)`, `CheckConstraint`; constraints are validated in `full_clean()` (Django 4.1+) and enforced by the DB.
- Use `qs.explain(analyze=True)` on PostgreSQL to confirm an index is used.

## Transactions and locking

- `ATOMIC_REQUESTS = True` wraps each view in a transaction (simple, but long requests hold connections). Otherwise use `with transaction.atomic():` around multi-write operations.
- `select_for_update(of=("self",), skip_locked=True)` inside `atomic()` for job-queue style tables.
- `transaction.on_commit(callback)` to enqueue tasks or send emails only after commit; in tests use `TestCase.captureOnCommitCallbacks(execute=True)` or pytest-django's `django_capture_on_commit_callbacks`.
- `TestCase` wraps each test in a transaction, so `on_commit` hooks do not fire unless captured; `TransactionTestCase` / `transaction=True` runs them for real but is slower.

## Caching

- `django.core.cache` with Redis (`django.core.cache.backends.redis.RedisCache`, Django 4.0+); `cache.get_or_set(key, fn, timeout)`.
- Template fragment caching `{% cache 600 sidebar request.user.pk %}`; per-view `@cache_page`.
- `cached_property` on models for per-instance expensive derived values.
- Invalidate explicitly on save (model method or service), not via signals unless unavoidable.

## Connection settings

- `CONN_MAX_AGE` (e.g. 60) for persistent connections under WSGI; `CONN_HEALTH_CHECKS = True` (Django 4.1+).
- With PgBouncer in transaction mode, set `CONN_MAX_AGE = 0` and disable server-side cursors (`DISABLE_SERVER_SIDE_CURSORS = True`).
