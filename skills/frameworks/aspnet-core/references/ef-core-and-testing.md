# EF Core and integration testing in ASP.NET Core

## DbContext lifetime

| Consumer | How to get a context |
|---|---|
| Request handler / scoped service | inject `AppDbContext` (registered by `AddDbContext`, scoped) |
| Singleton or `BackgroundService` | inject `IDbContextFactory<AppDbContext>` (`AddDbContextFactory`) or create a scope with `IServiceScopeFactory` |
| Blazor Server components | `IDbContextFactory`, one context per operation |
| Parallel work in one request | separate contexts; never share one across `Task.WhenAll` |

`AddDbContextPool` reuses instances for throughput; the context must not hold per-request state.

## Query translation tips

- Keep the whole query in LINQ-to-entities; call `ToListAsync()` once. Anything after `AsEnumerable()` runs client-side.
- Use `EF.Functions.Like`, `EF.Functions.ILike` (Npgsql), `EF.Property<T>` for shadow properties.
- String comparison: `StringComparison` arguments are not translated; rely on database collation or `ToLower()`.
- `DateTime.UtcNow` is parameterized; `DateOnly`/`TimeOnly` map natively (EF 8+).
- Owned types and complex types (EF 8 `ComplexProperty`) for value objects; JSON columns via `OwnsOne(...).ToJson()` (EF 7+).
- Global query filters (`HasQueryFilter(o => !o.IsDeleted)`) for soft delete/multi-tenancy; bypass with `IgnoreQueryFilters()`.
- Compiled queries (`EF.CompileAsyncQuery`) for very hot paths only.
- Inspect SQL: `query.ToQueryString()`, `EnableSensitiveDataLogging()` + `LogTo(Console.WriteLine)` in Development, or the `Microsoft.EntityFrameworkCore.Database.Command` log category at `Information`.

## Loading patterns

```csharp
// Projection (preferred for reads)
var dto = await db.Orders.AsNoTracking()
    .Where(o => o.Id == id)
    .Select(o => new OrderDto(o.Id, o.Reference, o.Items.Select(i => new ItemDto(i.Sku, i.Qty)).ToList()))
    .FirstOrDefaultAsync(ct);

// Graph for update
var order = await db.Orders.Include(o => o.Items).FirstOrDefaultAsync(o => o.Id == id, ct);

// Multiple collections: avoid cartesian explosion
var orders = await db.Orders.Include(o => o.Items).Include(o => o.Payments).AsSplitQuery().ToListAsync(ct);

// Bulk
await db.Orders.Where(o => o.Status == Status.Expired).ExecuteDeleteAsync(ct);
await db.Orders.Where(o => o.Id == id).ExecuteUpdateAsync(s => s.SetProperty(o => o.Status, Status.Paid), ct);
```

Lazy loading proxies (`UseLazyLoadingProxies`) make N+1 easy; avoid in APIs.

## Migrations workflow

1. Change the model/configuration.
2. `dotnet ef migrations add <Name> -p <infra project> -s <startup project> -o <folder>`.
3. Read the migration: check column types, nullability, index names, data loss warnings. Add data moves as `migrationBuilder.Sql(...)` steps.
4. Apply locally: `dotnet ef database update`. CI: `dotnet ef migrations bundle --self-contained -r linux-x64` produces an executable `efbundle` to run during deploy; or `migrations script --idempotent`.
5. Never edit an applied migration; add a corrective one. Keep `*ModelSnapshot.cs` committed with each migration.
6. Design-time: if the startup project cannot build a context at design time, add an `IDesignTimeDbContextFactory<AppDbContext>` reading a local connection string.

Multiple providers: separate migration assemblies per provider (`MigrationsAssembly(...)`).

## Integration testing setup

```csharp
public sealed class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _db = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
    private Respawner _respawner = default!;

    public async Task InitializeAsync()
    {
        await _db.StartAsync();
        using var scope = Services.CreateScope();
        var ctx = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await ctx.Database.MigrateAsync();
        await using var conn = new NpgsqlConnection(_db.GetConnectionString());
        await conn.OpenAsync();
        _respawner = await Respawner.CreateAsync(conn, new RespawnerOptions { DbAdapter = DbAdapter.Postgres });
    }

    public async Task ResetAsync()
    {
        await using var conn = new NpgsqlConnection(_db.GetConnectionString());
        await conn.OpenAsync();
        await _respawner.ResetAsync(conn);
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, cfg) => cfg.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:Default"] = _db.GetConnectionString(),
        }));
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IEmailSender>();
            services.AddSingleton<IEmailSender, FakeEmailSender>();
        });
    }

    public new async Task DisposeAsync() { await _db.DisposeAsync(); await base.DisposeAsync(); }
}
```

- Overriding configuration (connection string) is cleaner than removing and re-adding `DbContextOptions`.
- `ConfigureTestServices` runs after the app's own registrations, so replacements win.
- Share the factory across a test class (`IClassFixture<ApiFactory>`) or assembly (`[CollectionDefinition]`) and reset data with Respawn per test.
- Authenticated requests: register a test authentication scheme that creates a principal from headers, or mint real JWTs with a test signing key configured in `Testing` settings.
- `factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false })` for login/redirect assertions.
- Minimal API handlers can be unit-tested by extracting them into static methods and asserting on `Results<...>` types (`Assert.IsType<Ok<OrderDto>>(result.Result)`).

## Aspire note

Projects with an `AppHost` and `ServiceDefaults`: run `dotnet run --project src/AppHost` to start dependencies (Postgres, Redis) and services together; `Aspire.Hosting.Testing` gives `DistributedApplicationTestingBuilder` for integration tests against the whole graph.
