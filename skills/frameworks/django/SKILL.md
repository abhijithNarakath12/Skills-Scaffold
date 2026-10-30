---
name: django
description: Build and maintain Django 4.2/5.x projects, covering apps and settings, models and migrations, ORM querying and N+1 fixes (select_related/prefetch_related), function and class-based views, Django REST Framework APIs, forms, auth, admin, signals, management commands and testing with pytest-django. Use when a Python project depends on django, has a manage.py, or when editing models.py, views.py, urls.py, serializers.py, admin.py or migrations.
---

# Django

Assumes Django 4.2 LTS or 5.x (5.0: `db_default`, `GeneratedField`, field groups in templates; 5.1: `LoginRequiredMiddleware`, `{% querystring %}`; 5.2 LTS: composite primary keys, automatic model imports in `shell`). Check `django.__version__` or the pin in `pyproject.toml`/`requirements.txt` before using a newer feature.

## When to use

- Adding or changing models, migrations, views, URL routes, templates, forms, serializers, admin registrations or management commands.
- Fixing slow pages caused by ORM query patterns.
- Building JSON APIs with Django REST Framework (DRF) or Django Ninja.
- Writing tests with pytest-django or `django.test`.
- Not for FastAPI/Flask projects.

## Project conventions to detect first

1. Django version and extras in dependencies: `djangorestframework`, `django-ninja`, `django-filter`, `drf-spectacular`, `django-environ`/`python-decouple`/`pydantic-settings`, `celery`/`django-q2`/`rq`, `django-allauth`, `django-debug-toolbar`, `django-extensions`, `whitenoise`, `gunicorn`/`uvicorn`, `psycopg`.
2. Settings layout: single `settings.py` vs `settings/{base,dev,prod}.py` chosen via `DJANGO_SETTINGS_MODULE`; how secrets are read (`env()`, `os.environ`).
3. Project layout: project package (`config/` or `<project>/`) with `urls.py`, `asgi.py`, `wsgi.py`; apps at top level or under `apps/`; `AUTH_USER_MODEL` (custom user model?).
4. View style: FBVs, generic CBVs (`ListView`, `CreateView`), DRF `ViewSet`s + routers, or `APIView`s. Match the existing style per app.
5. Templates and frontend: Django templates with `django-htmx`/Tailwind/`django-compressor`, or SPA + DRF only. Static files via `whitenoise` or S3 (`django-storages`).
6. Database: `DATABASES` engine (PostgreSQL features like `ArrayField`, `JSONField` indexes); multiple DBs/routers.
7. Testing: `pytest.ini`/`pyproject.toml` `[tool.pytest.ini_options]` with `DJANGO_SETTINGS_MODULE`, `factory_boy`/`model_bakery`, `--reuse-db`. Or `manage.py test` with `TestCase`.
8. Linting/formatting: `ruff` (with `DJ` rules), `black`, `isort`, `mypy` + `django-stubs`.
9. Migrations: check `makemigrations --check` is clean before changing models.

## Core guidance

### Models and migrations

```python
class Order(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PAID = "paid", "Paid"

    customer = models.ForeignKey("customers.Customer", on_delete=models.PROTECT, related_name="orders")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)
    total = models.DecimalField(max_digits=10, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.CheckConstraint(condition=models.Q(total__gte=0), name="order_total_non_negative")]  # 'check=' on Django < 5.1
        indexes = [models.Index(fields=["customer", "status"])]

    def __str__(self) -> str:
        return f"Order {self.pk}"
```

- Always set `on_delete` explicitly and `related_name` on FKs; use `PROTECT` for financial data, `CASCADE` for owned children, `SET_NULL` with `null=True` for optional links.
- Business rules belong in model methods, managers/`QuerySet` subclasses (`Order.objects.paid()`), or a `services.py` module; not in views.
- Custom querysets: `class OrderQuerySet(models.QuerySet): def paid(self): return self.filter(status=Order.Status.PAID)` and `objects = OrderQuerySet.as_manager()`.
- `python manage.py makemigrations <app> -n descriptive_name`; review the file; never edit applied migrations. Data migrations use `RunPython` with `apps.get_model()`, never direct model imports.
- Adding a non-null field to a populated table: add with a default or nullable first, backfill, then tighten.
- Use `TextChoices`/`IntegerChoices`, `UUIDField` for public ids when exposure matters, `DecimalField` for money.
- Database-level defaults with `db_default` (5.0+); `GeneratedField` for computed columns.

### Querying and N+1

- `select_related("customer")` for FK/OneToOne (SQL JOIN); `prefetch_related("items", Prefetch("items", queryset=Item.objects.select_related("product")))` for reverse FK and M2M.
- `only()`/`defer()` to trim columns; `values()`/`values_list(flat=True)` when you do not need model instances.
- Aggregate in the DB: `annotate(item_count=Count("items"))`, `aggregate(Sum("total"))`, `Subquery`/`OuterRef`, `Exists`, `F()` expressions for atomic updates (`F("stock") - 1`), `Case`/`When`.
- `bulk_create`, `bulk_update`, `update()`, `delete()` for mass changes (note: `update()` bypasses `save()` and signals).
- `exists()` instead of `count() > 0` or `len(qs)`; `iterator(chunk_size=...)` for large exports.
- `transaction.atomic()` around multi-row writes; `select_for_update()` for row locks.
- Detect N+1 with `django-debug-toolbar`, `assertNumQueries`, or `nplusone`. Any loop that touches `obj.fk` or `obj.related_set.all()` is a suspect.

### Views, URLs and templates

- FBVs for simple pages, generic CBVs when they fit cleanly (`ListView` with `get_queryset`, `CreateView` with `form_class`); do not fight CBV mixins for unusual flows.
- `urls.py` per app with `app_name = "orders"` and named routes; reference with `reverse("orders:detail", args=[pk])` / `{% url 'orders:detail' order.pk %}`.
- Use `get_object_or_404`, `@login_required`/`LoginRequiredMixin`, `@require_http_methods(["POST"])`, `@permission_required`.
- Pass the minimum context; compute in the view or model, not in templates. Templates are escaped by default; only `|safe`/`mark_safe` trusted content.
- Forms: `ModelForm` with `Meta.fields` explicit (never `"__all__"` on models with sensitive fields); validate in `clean_<field>`/`clean`; `form.is_valid()` then `form.save()`. CSRF tokens on every POST form.
- Messages framework for flash messages; `redirect()` after successful POST.
- Middleware order matters: `SecurityMiddleware` first, `SessionMiddleware` before `AuthenticationMiddleware`, `CsrfViewMiddleware` before views that need it; `whitenoise` right after `SecurityMiddleware`.

### Django REST Framework

```python
class OrderSerializer(serializers.ModelSerializer):
    class Meta:
        model = Order
        fields = ["id", "customer", "status", "total", "created_at"]
        read_only_fields = ["id", "created_at"]

class OrderViewSet(viewsets.ModelViewSet):
    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["status"]

    def get_queryset(self):
        return Order.objects.filter(customer__user=self.request.user).select_related("customer").prefetch_related("items")

router = DefaultRouter()
router.register("orders", OrderViewSet, basename="order")
```

- Optimize `get_queryset` for what the serializer touches; nested serializers are N+1 magnets.
- Separate read/write serializers (`get_serializer_class`) when shapes differ.
- Validation in `validate_<field>`/`validate`; object-level permissions with `has_object_permission`.
- Global settings in `REST_FRAMEWORK`: authentication classes (Session + Token/JWT via `djangorestframework-simplejwt`), default permissions (`IsAuthenticated`), pagination, throttling, `DEFAULT_SCHEMA_CLASS` (`drf_spectacular`).
- Django Ninja projects use Pydantic `Schema` classes and `@router.get` decorators; do not mix with DRF in the same app.

### Auth, settings and security

- Custom user model from day one (`AUTH_USER_MODEL = "accounts.User"` extending `AbstractUser`); changing later is painful. Reference via `settings.AUTH_USER_MODEL` in FKs and `get_user_model()` in code.
- Permissions: groups + `has_perm`, or object permissions via `django-guardian`/custom checks.
- Settings from environment: `SECRET_KEY`, `DEBUG=False` in prod, `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `DATABASES` via `env.db()`, `SECURE_*` flags, `SESSION_COOKIE_SECURE`. Run `manage.py check --deploy` before shipping.
- Static: `STATIC_ROOT` + `collectstatic`; media uploads to `MEDIA_ROOT` or object storage; never serve user uploads from the app domain without content-type controls.

### Admin

- Register with `@admin.register(Order)` and a `ModelAdmin`: `list_display`, `list_filter`, `search_fields`, `list_select_related`, `raw_id_fields`/`autocomplete_fields` for big FKs, `readonly_fields`, inlines.
- Admin is for staff; do not build customer-facing features on it.

### Signals and background work

- Prefer explicit service calls over signals; signals hide control flow and run inside the caller's transaction. Use them only for decoupled cross-app reactions, connect in `AppConfig.ready()`, and keep handlers idempotent.
- Use `transaction.on_commit(lambda: task.delay(...))` before enqueueing Celery/RQ jobs so the row exists when the worker runs.
- Long work goes to Celery/django-q2/RQ or `manage.py` commands under cron, never into the request.

### Management commands

`app/management/commands/<name>.py` with `class Command(BaseCommand)`, `add_arguments(self, parser)` and `handle(self, *args, **options)`; use `self.stdout.write(self.style.SUCCESS(...))`; wrap writes in `transaction.atomic()`; test via `call_command("name", stdout=out)`.

## Common tasks

### Create an app and model

```bash
python manage.py startapp orders            # then add "orders" (or "orders.apps.OrdersConfig") to INSTALLED_APPS
python manage.py makemigrations orders -n create_order
python manage.py migrate
python manage.py makemigrations --check --dry-run   # should report no changes afterwards
```

### Add a page

1. View in `views.py` (FBV or CBV) with auth decorators.
2. Route in app `urls.py`; ensure the app's urls are included in the project `urls.py`.
3. Template under `<app>/templates/<app>/<name>.html` extending `base.html`.
4. Test: `client.get(reverse("orders:list"))` asserts status, template used, and `assertNumQueries`.

### Add an API resource (DRF)

1. Serializer, ViewSet with optimized `get_queryset`, router registration.
2. Permissions and filters; pagination inherits from settings.
3. Tests with `APIClient` (`client.force_authenticate(user)`), covering list/detail/create/validation.
4. Regenerate schema if `drf-spectacular` is used (`manage.py spectacular --file schema.yml`).

### Fix an N+1

1. Reproduce with `assertNumQueries` or debug toolbar.
2. Add `select_related`/`prefetch_related` in the queryset the view/serializer uses (not in the model's default manager unless universal).
3. Re-run the test to lock the query count.

### Write tests (pytest-django)

```python
import pytest
from django.urls import reverse

@pytest.mark.django_db
def test_order_list_requires_login(client):
    assert client.get(reverse("orders:list")).status_code == 302

@pytest.mark.django_db
def test_order_list(client, django_user_model, django_assert_num_queries):
    user = django_user_model.objects.create_user("u", password="p")
    client.force_login(user)
    with django_assert_num_queries(3):
        resp = client.get(reverse("orders:list"))
    assert resp.status_code == 200
```

Use factories (`factory_boy`) for fixtures, `settings` fixture to override settings, `mailoutbox` for emails, `freezegun`/`time_machine` for time.

## Pitfalls

- Logic in views/templates instead of models/services; fat views are hard to test.
- Missing `select_related`/`prefetch_related` in list views and DRF list serializers.
- Editing or deleting applied migrations; merge conflicts resolved by `makemigrations --merge` without review.
- Importing models at module level in `migrations` or `apps.py` `ready()` before the registry is ready.
- `fields = "__all__"` in forms/serializers exposing privileged fields; `is_staff`/`is_superuser` writable through an API.
- Using `DEBUG=True`, wildcard `ALLOWED_HOSTS`, or hard-coded `SECRET_KEY` in committed settings.
- `objects.get()` without catching `DoesNotExist`/`MultipleObjectsReturned`; use `get_object_or_404` or `.filter().first()`.
- `auto_now` fields and `update()`/`bulk_update()` (not triggered); signals not fired by bulk operations.
- Timezone-naive datetimes with `USE_TZ=True`; use `django.utils.timezone.now()`.
- Enqueueing tasks before commit (worker cannot find the row).
- Running `collectstatic` or `migrate` only in some environments; keep them in the deploy pipeline.

## Verification

```bash
python manage.py check && python manage.py check --deploy
python manage.py makemigrations --check --dry-run
python manage.py migrate
pytest -q                     # or: python manage.py test
ruff check . && ruff format --check .
mypy .                        # if django-stubs configured
python manage.py runserver    # smoke test; python manage.py shell for ad-hoc ORM checks
```

## References

- [references/orm-performance.md](references/orm-performance.md): N+1 diagnosis, prefetch patterns, annotations and transaction tips.
- Django docs: https://docs.djangoproject.com/en/stable/
- Release notes (feature availability by version): https://docs.djangoproject.com/en/stable/releases/
- DRF docs: https://www.django-rest-framework.org/
- pytest-django: https://pytest-django.readthedocs.io/
- Deployment checklist: https://docs.djangoproject.com/en/stable/howto/deployment/checklist/
