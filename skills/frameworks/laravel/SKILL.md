---
name: laravel
description: Build and maintain Laravel 11/12 applications, covering artisan, routing and controllers, Eloquent (relations, scopes, N+1 with eager loading), migrations, validation and Form Requests, middleware, auth with Sanctum/Breeze/Fortify, queues and jobs, Blade or Inertia frontends, config and .env, testing with Pest or PHPUnit, and formatting with Pint. Use when a project has composer dependency laravel/framework or an artisan file, or when editing routes/*.php, app/Http, app/Models, database/migrations or config/*.php.
---

# Laravel

Assumes Laravel 11 or 12 on PHP 8.2+ (slim skeleton: no `app/Http/Kernel.php` or `app/Console/Kernel.php`; middleware, exceptions and scheduling are configured in `bootstrap/app.php` and `routes/console.php`). Laravel 10 and earlier keep the Kernel classes and `app/Http/Middleware` registrations; check before editing.

## When to use

- Adding routes, controllers, Form Requests, middleware, policies, Eloquent models, migrations, factories, seeders, jobs, events, notifications or mail.
- Fixing N+1 queries, slow Eloquent code, or caching.
- Blade/Livewire/Inertia frontends in a Laravel app.
- Writing Pest/PHPUnit feature and unit tests.
- Not for Symfony, Slim or plain PHP projects.

## Project conventions to detect first

1. Laravel and PHP versions in `composer.json` (`laravel/framework`, `php`); `composer.lock` for exact. `php artisan --version`.
2. Skeleton: `bootstrap/app.php` using `Application::configure()->withMiddleware()->withExceptions()` (11+) vs `app/Http/Kernel.php` (<= 10). Route files present: `routes/web.php`, `routes/api.php` (11+: created by `php artisan install:api`), `routes/console.php`, `routes/channels.php`.
3. Frontend stack: Blade only, `livewire/livewire` (+ Volt), `inertiajs/inertia-laravel` with Vue/React/Svelte (`resources/js/Pages`), API-only consumed by a separate SPA; `vite.config.js`, Tailwind.
4. Auth: `laravel/breeze` (Blade/Inertia/API scaffolds), `laravel/fortify`, `laravel/jetstream`, `laravel/sanctum` (SPA cookies or API tokens), `laravel/passport`, `laravel/socialite`. Guards in `config/auth.php`.
5. Database: `config/database.php` default (`sqlite` default in 11+, `mysql`, `pgsql`), `database/migrations`, factories and seeders, `laravel/scout`, `spatie/laravel-*` packages.
6. Queues/jobs: `QUEUE_CONNECTION` (`database` default in 11+, `redis`, `sqs`), `laravel/horizon`, scheduled tasks in `routes/console.php` (`Schedule::command(...)`).
7. Tests: `tests/Feature`, `tests/Unit`; Pest (`pestphp/pest`, `tests/Pest.php`) vs PHPUnit (`phpunit.xml`); `RefreshDatabase`/`LazilyRefreshDatabase`; test DB (`:memory:` sqlite in `phpunit.xml`).
8. Code style/static analysis: `laravel/pint` (`pint.json`), `larastan/larastan` (`phpstan.neon`), `rector`, `barryvdh/laravel-ide-helper`, `barryvdh/laravel-debugbar`, `laravel/telescope`.
9. API conventions: `app/Http/Resources` (JSON resources), API versioning prefixes, `spatie/laravel-query-builder`, `scribe`/`l5-swagger` docs.

## Core guidance

### Routing and controllers

```php
// routes/api.php
Route::middleware('auth:sanctum')->group(function () {
    Route::apiResource('orders', OrderController::class);
    Route::post('orders/{order}/cancel', [OrderController::class, 'cancel'])->name('orders.cancel');
});

// app/Http/Controllers/OrderController.php
class OrderController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $orders = $request->user()->orders()->with(['customer', 'items.product'])->latest()->paginate(20);
        return OrderResource::collection($orders);
    }

    public function store(StoreOrderRequest $request): OrderResource
    {
        $order = $request->user()->orders()->create($request->validated());
        return new OrderResource($order);
    }

    public function show(Order $order): OrderResource
    {
        $this->authorize('view', $order);   // or Gate::authorize(); Laravel 11 base Controller has no traits by default
        return new OrderResource($order->load('items.product'));
    }
}
```

- Resourceful controllers (`php artisan make:controller OrderController --api --model=Order --requests`); single-action controllers (`__invoke`) for one-offs.
- Route model binding (`{order}`) resolves `Order::findOrFail`; scope child bindings with `->scopeBindings()`; customize with `getRouteKeyName()` or `{order:uuid}`.
- Named routes everywhere (`route('orders.show', $order)`); group by middleware/prefix; API routes get the `api` middleware group and `/api` prefix automatically when `routes/api.php` is registered.
- Controllers stay thin: validation in Form Requests, authorization in Policies, business logic in Actions/Services (`app/Actions`, `app/Services`) or model methods.
- Return JSON resources (`JsonResource`/`ResourceCollection`) for APIs; never return raw models (exposes hidden-by-mistake fields, unstable shape).
- Laravel 11: `php artisan install:api` to add Sanctum + `routes/api.php`; `install:broadcasting` for channels.

### Validation and Form Requests

```php
class StoreOrderRequest extends FormRequest
{
    public function authorize(): bool { return $this->user()->can('create', Order::class); }

    public function rules(): array
    {
        return [
            'customer_id' => ['required', Rule::exists('customers', 'id')->where('team_id', $this->user()->team_id)],
            'items' => ['required', 'array', 'min:1'],
            'items.*.product_id' => ['required', 'integer', 'exists:products,id'],
            'items.*.quantity' => ['required', 'integer', 'min:1', 'max:999'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
```

- Array syntax rules; `Rule::` objects for `in`, `unique` (with `->ignore($model)`), `exists`, `enum`, `Password::defaults()`.
- Use `$request->validated()` or `$request->safe()->only([...])`; never `$request->all()` into `create()`.
- Validation failures return 422 JSON for API/JSON requests and redirect back with errors for web requests automatically.
- `prepareForValidation()` to normalize input; `after()` for cross-field rules; custom rules via `php artisan make:rule`.

### Eloquent

```php
class Order extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = ['customer_id', 'status', 'total_cents', 'notes'];

    protected function casts(): array   // Laravel 11+; use protected $casts array on <= 10
    {
        return ['status' => OrderStatus::class, 'shipped_at' => 'datetime', 'meta' => 'array'];
    }

    public function customer(): BelongsTo { return $this->belongsTo(Customer::class); }
    public function items(): HasMany { return $this->hasMany(OrderItem::class); }

    public function scopePaid(Builder $query): Builder { return $query->where('status', OrderStatus::Paid); }
    // Laravel 12: #[Scope] attribute on a method named without the scope prefix is also supported

    protected static function booted(): void
    {
        static::creating(fn (Order $order) => $order->reference ??= Str::ulid());
    }
}
```

- `$fillable` (allow-list) over `$guarded = []`; enums via backed enum casts; `$hidden` for secrets; `$appends` sparingly.
- Relationships typed with return types; `with()`/`load()`/`loadMissing()` for eager loading; `withCount()`, `withSum()`, `withExists()` for aggregates; `whereHas`/`whereRelation`/`whereBelongsTo` for filtering.
- Prevent N+1 in development: `Model::preventLazyLoading(! app()->isProduction())` in `AppServiceProvider::boot()` (often via `Model::shouldBeStrict()` which also prevents silently discarding attributes and accessing missing attributes).
- Querying: `Order::query()->where(...)->latest()->cursorPaginate()`; `chunkById`/`lazyById` for big tables; `upsert()`, `insert()`, `update()` for bulk (no events, no timestamps unless specified).
- Attribute accessors/mutators with `Attribute::make(get:, set:)`; `$casts` for dates/json/encrypted (`'secret' => 'encrypted'`).
- Transactions: `DB::transaction(fn () => ...)` with retries argument; `lockForUpdate()`; `afterCommit` on jobs/listeners or `DB::afterCommit()`.
- Migrations: `php artisan make:migration create_orders_table`; use `$table->foreignIdFor(Customer::class)->constrained()->cascadeOnDelete()`, `index()`, `unique()`, `->after()`; schema changes on large tables need care (`doctrine/dbal` no longer required in 11 for column changes). Never edit a migration that has run in shared environments; add a new one.

### Middleware, auth and authorization

- Laravel 11+: register/alias middleware in `bootstrap/app.php` `->withMiddleware(function (Middleware $middleware) { $middleware->alias(['admin' => EnsureIsAdmin::class]); $middleware->api(prepend: [...]); })`. Create with `php artisan make:middleware`.
- Sanctum: SPA auth via cookies (`EnsureFrontendRequestsAreStateful`, `statefulApi()` in 11, `SANCTUM_STATEFUL_DOMAINS`, CSRF cookie `GET /sanctum/csrf-cookie`); mobile/API tokens via `$user->createToken('name', ['abilities'])->plainTextToken` and `auth:sanctum` guard.
- Policies: `php artisan make:policy OrderPolicy --model=Order`; auto-discovered by naming; use `$this->authorize()`/`Gate::authorize()`/`@can` and `->can('update', $order)` in routes (`->middleware('can:update,order')`).
- Password hashing automatic via `'password' => 'hashed'` cast (10+); `Hash::make` otherwise. Rate limit logins with `RateLimiter`/`throttle:` middleware.
- Breeze/Fortify handle registration, login, password reset, email verification; do not hand-roll these.

### Queues, events, scheduling

- `php artisan make:job ProcessOrder` (implements `ShouldQueue`); dispatch with `ProcessOrder::dispatch($order)->afterCommit()`; set `$tries`, `$backoff`, `$timeout`; make jobs idempotent; use `ShouldBeUnique` when needed. Run with `php artisan queue:work --tries=3` (or Horizon). Monitor failed jobs: `queue:failed`, `queue:retry all`.
- Events + listeners (`make:event`, `make:listener --queued`), auto-discovered in 11+. Notifications via `make:notification` (mail, database, Slack channels).
- Scheduler in `routes/console.php`: `Schedule::job(new PruneOrders)->dailyAt('02:00')->onOneServer();` and a cron entry `* * * * * php artisan schedule:run`.
- Cache: `Cache::remember($key, $ttl, fn () => ...)`, tags only on Redis/Memcached; `Cache::lock()` for atomic sections.

### Config and environment

- Read env only in `config/*.php` (`env('STRIPE_KEY')`); everywhere else use `config('services.stripe.key')`. `php artisan config:cache` makes `env()` return null outside config files.
- `.env.example` kept in sync; never commit `.env`. `APP_KEY` via `php artisan key:generate`.
- Production: `php artisan optimize` (config, route, view, event caches), `APP_DEBUG=false`, `APP_ENV=production`, queue workers supervised, `storage:link` for public uploads.

### Frontend (Blade / Inertia / Livewire)

- Blade: components in `resources/views/components` (`<x-alert type="error"/>`), layouts via `<x-layout>` slots, `@foreach`, `{{ }}` escapes while `{!! !!}` does not; `@csrf` and `@method('PUT')` in forms; `@can`, `@auth`.
- Inertia: controllers return `Inertia::render('Orders/Index', ['orders' => OrderResource::collection(...)])`; shared props in `HandleInertiaRequests`; forms via `useForm`. Pages live in `resources/js/Pages`.
- Livewire: `php artisan make:livewire Orders\\Table`; public properties are state; validate with `#[Validate]` attributes; keep heavy queries in computed properties.
- Vite: `npm run dev` / `npm run build`; `@vite(['resources/css/app.css', 'resources/js/app.js'])` in the layout.

## Common tasks

### Add a resource (API)

```bash
php artisan make:model Order -mfs --policy          # model + migration + factory + seeder + policy
php artisan make:controller Api/OrderController --api --model=Order --requests
php artisan make:resource OrderResource
php artisan migrate
```

Then: fill migration columns/indexes, `$fillable` + casts + relations, Form Request rules, Policy methods, controller actions, `Route::apiResource`, JSON resource fields, factory states, and a feature test per action.

### Fix an N+1

1. Enable `Model::shouldBeStrict()` locally or install Debugbar/Telescope to see queries.
2. Add `with([...])` to the query in the controller/query class (or `$with` on the model only when always needed).
3. Assert in a test with `$this->expectsDatabaseQueryCount(n)` (Laravel 10+).

### Add a queued job

1. `php artisan make:job SendOrderReceipt`; constructor receives the model (serialized by id via `SerializesModels`).
2. Dispatch after commit; configure retries/backoff; handle failure in `failed(Throwable $e)`.
3. Test with `Queue::fake()` + `Queue::assertPushed(SendOrderReceipt::class)` and a direct `handle()` unit test.

### Write tests (Pest)

```php
use App\Models\{Order, User};
use function Pest\Laravel\{actingAs, postJson};

uses(Illuminate\Foundation\Testing\RefreshDatabase::class);

it('creates an order', function () {
    $user = User::factory()->create();

    actingAs($user)
        ->postJson(route('orders.store'), ['customer_id' => $user->customer->id, 'items' => [['product_id' => 1, 'quantity' => 2]]])
        ->assertCreated()
        ->assertJsonPath('data.status', 'pending');

    $this->assertDatabaseHas('orders', ['customer_id' => $user->customer->id]);
});

it('rejects empty items', function () {
    actingAs(User::factory()->create())
        ->postJson(route('orders.store'), ['items' => []])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['items']);
});
```

PHPUnit equivalent: `class OrderTest extends TestCase { use RefreshDatabase; public function test_...(): void { $this->actingAs(...)->postJson(...) } }`. Fake side effects: `Mail::fake()`, `Notification::fake()`, `Event::fake()`, `Storage::fake('s3')`, `Http::fake()`, `Bus::fake()`.

## Pitfalls

- `env()` outside `config/` (breaks under `config:cache`).
- `$guarded = []` or passing `$request->all()` to `create()` (mass assignment).
- Lazy-loading in loops (N+1) and `->get()` on big tables without chunking.
- Returning Eloquent models/collections directly from API controllers instead of resources.
- Business logic in controllers or Blade; validation inline instead of Form Requests.
- Forgetting `afterCommit()`/`ShouldQueueAfterCommit` so jobs run before the transaction commits.
- Editing already-deployed migrations; running `migrate:fresh` on shared databases.
- Laravel 11 skeleton: adding middleware to a non-existent `Kernel.php` or `RouteServiceProvider`; the places are `bootstrap/app.php` and `AppServiceProvider`.
- Missing `php artisan storage:link`, `config:clear` after `.env` changes, or `optimize:clear` when caches are stale.
- Tests sharing state because `RefreshDatabase` is missing, or hitting external services without `Http::fake()`.
- Running Pint/PHPStan only locally; wire them into CI (`vendor/bin/pint --test`, `vendor/bin/phpstan analyse`).

## Verification

```bash
composer validate && composer install
php artisan about                     # versions, drivers, caches
php artisan route:list --except-vendor
php artisan migrate --pretend         # preview SQL; then php artisan migrate
php artisan test --parallel           # Pest or PHPUnit (vendor/bin/pest, vendor/bin/phpunit)
vendor/bin/pint --test                # formatting
vendor/bin/phpstan analyse            # if larastan configured
npm run build                         # Vite assets
php artisan optimize:clear            # reset caches after config/route changes
```

## References

- [references/eloquent-performance.md](references/eloquent-performance.md): eager loading strategies, aggregates, chunking, indexing and query debugging.
- Laravel docs: https://laravel.com/docs
- Upgrade guide (11/12 skeleton changes): https://laravel.com/docs/upgrade
- Eloquent relationships: https://laravel.com/docs/eloquent-relationships
- Pest: https://pestphp.com/docs
- Pint: https://laravel.com/docs/pint
