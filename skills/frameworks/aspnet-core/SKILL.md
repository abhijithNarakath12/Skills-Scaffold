---
name: aspnet-core
description: Build and maintain ASP.NET Core 8/9 web APIs and apps in C#, covering minimal APIs vs controllers, dependency injection, configuration and the Options pattern, EF Core (DbContext, migrations, queries), validation, middleware, authentication with ASP.NET Core Identity or JWT bearer, logging, and integration testing with WebApplicationFactory via the dotnet CLI. Use when a project targets Microsoft.NET.Sdk.Web, references Microsoft.AspNetCore.App or Microsoft.EntityFrameworkCore, or when editing Program.cs, appsettings.json, Controllers, endpoints, DbContext classes or Migrations.
---

# ASP.NET Core

Assumes .NET 8 LTS or .NET 9 with the minimal hosting model (`WebApplication.CreateBuilder` in `Program.cs`, top-level statements, nullable reference types and implicit usings enabled). `Startup.cs` + `IWebHostBuilder` is the legacy pattern; follow it only in projects that already use it.

## When to use

- Adding endpoints (minimal API or MVC controllers), services, middleware, filters, options or background services.
- EF Core models, `DbContext` configuration, migrations and LINQ queries.
- Auth (Identity, cookie, JWT bearer), authorization policies.
- Configuration, logging, health checks, OpenAPI.
- Integration tests with `WebApplicationFactory<Program>`.
- Not for Blazor component internals, MAUI, or classic ASP.NET (.NET Framework).

## Project conventions to detect first

1. Target framework and SDK: `<TargetFramework>net8.0|net9.0</TargetFramework>`, `Sdk="Microsoft.NET.Sdk.Web"`, `global.json`, `Directory.Build.props`, `Directory.Packages.props` (central package management).
2. API style: minimal APIs (`app.MapGet`, `MapGroup`, endpoint extension methods per feature) vs controllers (`[ApiController]`, `ControllerBase`, `AddControllers()`), or both. Match per area.
3. Architecture: single project vs Clean/Vertical Slice (`Api`, `Application`, `Domain`, `Infrastructure` projects), MediatR, FluentValidation, AutoMapper/Mapster, Carter/FastEndpoints.
4. Data: EF Core provider (`Npgsql.EntityFrameworkCore.PostgreSQL`, `Microsoft.EntityFrameworkCore.SqlServer`, `Sqlite`), `Migrations/` folder location, `IDesignTimeDbContextFactory`, Dapper usage.
5. Auth: `Microsoft.AspNetCore.Identity.EntityFrameworkCore` (+ `MapIdentityApi` in .NET 8), `Microsoft.AspNetCore.Authentication.JwtBearer`, OpenIddict/Duende, external providers; policies in `AddAuthorization`.
6. OpenAPI: `Microsoft.AspNetCore.OpenApi` (`AddOpenApi`/`MapOpenApi`, .NET 9) vs `Swashbuckle.AspNetCore` (`AddSwaggerGen`) vs NSwag.
7. Config and secrets: `appsettings.json`, `appsettings.{Environment}.json`, user secrets (`<UserSecretsId>`), env vars (`Section__Key`), Azure Key Vault/AWS providers; `ASPNETCORE_ENVIRONMENT`.
8. Tests: xUnit (default) / NUnit / MSTest, `Microsoft.AspNetCore.Mvc.Testing`, `Testcontainers`, `Respawn`, FluentAssertions/Shouldly, `NSubstitute`/`Moq`.
9. Quality: `.editorconfig`, `<TreatWarningsAsErrors>`, `<Nullable>enable</Nullable>`, analyzers, `dotnet format`, Aspire AppHost (`*.AppHost` project) for orchestration.

## Core guidance

### Program.cs and DI

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<AppDbContext>(o => o.UseNpgsql(builder.Configuration.GetConnectionString("Default")));
builder.Services.AddOptions<SmtpOptions>().BindConfiguration(SmtpOptions.Section).ValidateDataAnnotations().ValidateOnStart();
builder.Services.AddScoped<IOrderService, OrderService>();
builder.Services.AddProblemDetails();
builder.Services.AddOpenApi();                 // .NET 9; Swashbuckle on .NET 8
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
builder.Services.AddAuthorizationBuilder().AddPolicy("Admin", p => p.RequireRole("admin"));
builder.Services.AddHealthChecks().AddDbContextCheck<AppDbContext>();

var app = builder.Build();

app.UseExceptionHandler();                     // with AddProblemDetails -> RFC 9457 responses
app.UseHttpsRedirection();
app.UseAuthentication();
app.UseAuthorization();
if (app.Environment.IsDevelopment()) app.MapOpenApi();
app.MapHealthChecks("/healthz");
app.MapOrderEndpoints();                       // extension method per feature
app.Run();

public partial class Program { }               // lets WebApplicationFactory<Program> see the entry point
```

- Lifetimes: `Transient` (stateless, cheap), `Scoped` (per request: `DbContext`, unit-of-work services), `Singleton` (caches, `HttpClient` factories, options). Never inject a scoped service into a singleton; use `IServiceScopeFactory` in background services.
- Prefer constructor injection; primary constructors (C# 12) are fine. Minimal API handlers get services as parameters (`[FromServices]` is inferred).
- `HttpClient` via `AddHttpClient<TClient>()` (typed clients) with resilience (`Microsoft.Extensions.Http.Resilience`), never `new HttpClient()` per call.
- Background work: `IHostedService`/`BackgroundService` with `IServiceScopeFactory`; for queues use Channels, Hangfire, Quartz, or Azure/AWS queue SDKs.
- Keyed services (.NET 8): `AddKeyedScoped<IPayment, Stripe>("stripe")`, `[FromKeyedServices("stripe")]`.

### Minimal APIs

```csharp
public static class OrderEndpoints
{
    public static RouteGroupBuilder MapOrderEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/orders").WithTags("Orders").RequireAuthorization();

        group.MapGet("/{id:int}", async Task<Results<Ok<OrderDto>, NotFound>> (int id, AppDbContext db, CancellationToken ct) =>
            await db.Orders.AsNoTracking().Where(o => o.Id == id).Select(o => o.ToDto()).FirstOrDefaultAsync(ct)
                is { } dto ? TypedResults.Ok(dto) : TypedResults.NotFound());

        group.MapPost("/", async Task<Results<Created<OrderDto>, ValidationProblem>> (CreateOrderRequest req, IOrderService svc, CancellationToken ct) =>
        {
            var result = await svc.CreateAsync(req, ct);
            return TypedResults.Created($"/api/orders/{result.Id}", result);
        })
        .AddEndpointFilter<ValidationFilter<CreateOrderRequest>>();

        return group;
    }
}
```

- `TypedResults` + `Results<T1, T2>` return types so OpenAPI metadata is inferred and tests can pattern-match.
- `MapGroup` for shared prefix, auth, filters and tags; `WithName` for `LinkGenerator`.
- Binding: route/query/header/body are inferred; `[AsParameters]` for grouped query params; `BindAsync`/`TryParse` for custom types; `IFormFile` for uploads (`.DisableAntiforgery()` where appropriate in .NET 8+).
- Validation: no built-in attribute validation in minimal APIs before .NET 10; use FluentValidation (`IValidator<T>`) in an endpoint filter, or `MiniValidation`. Return `TypedResults.ValidationProblem(errors)`.
- Always accept and forward `CancellationToken`.

### Controllers

```csharp
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class OrdersController(IOrderService orders) : ControllerBase
{
    [HttpGet("{id:int}")]
    [ProducesResponseType<OrderDto>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<OrderDto>> Get(int id, CancellationToken ct)
        => await orders.GetAsync(id, ct) is { } dto ? Ok(dto) : NotFound();

    [HttpPost]
    public async Task<ActionResult<OrderDto>> Create(CreateOrderRequest request, CancellationToken ct)
    {
        var dto = await orders.CreateAsync(request, ct);
        return CreatedAtAction(nameof(Get), new { id = dto.Id }, dto);
    }
}
```

- `[ApiController]` gives automatic 400 `ValidationProblemDetails` from DataAnnotations/`IValidatableObject`, binding source inference and `ProblemDetails` for errors.
- Keep controllers thin; `ActionResult<T>`; `[ProducesResponseType]` for OpenAPI accuracy.
- Filters (`IActionFilter`, `IExceptionFilter`) for cross-cutting MVC-only concerns; otherwise use middleware.

### Configuration and Options

```csharp
public sealed class SmtpOptions
{
    public const string Section = "Smtp";
    [Required] public string Host { get; init; } = "";
    [Range(1, 65535)] public int Port { get; init; } = 587;
}
// inject IOptions<SmtpOptions> (singleton snapshot), IOptionsSnapshot<T> (scoped, reloads), IOptionsMonitor<T> (singleton, change notifications)
```

- Bind sections to typed options; validate with `ValidateDataAnnotations()`/`Validate(...)` and `ValidateOnStart()`.
- Environment-specific values in `appsettings.{Environment}.json`; secrets in user secrets (`dotnet user-secrets set "ConnectionStrings:Default" "..."`) locally and env vars/Key Vault in production. Env var `Smtp__Host` maps to `Smtp:Host`.
- `builder.Configuration.GetConnectionString("Default")` reads `ConnectionStrings:Default`.

### EF Core

```csharp
public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Order> Orders => Set<Order>();
    protected override void OnModelCreating(ModelBuilder b) => b.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
}

public class OrderConfiguration : IEntityTypeConfiguration<Order>
{
    public void Configure(EntityTypeBuilder<Order> b)
    {
        b.HasKey(o => o.Id);
        b.Property(o => o.Reference).HasMaxLength(32).IsRequired();
        b.HasIndex(o => new { o.CustomerId, o.Status });
        b.HasMany(o => o.Items).WithOne(i => i.Order).HasForeignKey(i => i.OrderId).OnDelete(DeleteBehavior.Cascade);
        b.Property(o => o.RowVersion).IsRowVersion();   // optimistic concurrency
    }
}
```

- `DbContext` is scoped and not thread-safe; one per request, injected. In singletons/background services use `IDbContextFactory<AppDbContext>`.
- Queries: `AsNoTracking()` for reads; project with `Select` into DTOs instead of loading entities then mapping (avoids over-fetching and N+1); `Include`/`ThenInclude` only when you need tracked graphs; `AsSplitQuery()` for multiple collection includes; `ExecuteUpdateAsync`/`ExecuteDeleteAsync` (EF 7+) for bulk.
- Avoid client evaluation: anything EF cannot translate throws; keep filtering server-side and `ToListAsync()` late.
- Migrations: `dotnet ef migrations add AddOrders --project src/Infrastructure --startup-project src/Api`, review the generated `Up/Down`, apply with `dotnet ef database update` or at deploy time with a migration bundle (`dotnet ef migrations bundle`). Avoid `Database.Migrate()` on startup for multi-instance deployments; `EnsureCreated()` is for throwaway/testing only.
- Install the tool: `dotnet tool install --global dotnet-ef` (match the EF Core major) and reference `Microsoft.EntityFrameworkCore.Design` in the startup project.
- Concurrency: `RowVersion`/`IsConcurrencyToken`; catch `DbUpdateConcurrencyException`. Transactions: `await using var tx = await db.Database.BeginTransactionAsync(ct)` when spanning multiple `SaveChanges`; use execution strategies with retrying providers.

### Middleware and errors

- Order matters: `UseExceptionHandler` -> `UseHsts`/`UseHttpsRedirection` -> `UseStaticFiles`/`MapStaticAssets` -> `UseRouting` (implicit) -> `UseCors` -> `UseAuthentication` -> `UseAuthorization` -> endpoints. CORS must come before auth; `UseAuthentication` before `UseAuthorization`.
- `AddProblemDetails()` + `UseExceptionHandler()` + `UseStatusCodePages()`; customize with `IExceptionHandler` implementations (`AddExceptionHandler<T>()`, .NET 8) mapping domain exceptions to status codes. Never return stack traces in production (`UseDeveloperExceptionPage` only in Development, which the template does automatically).
- Custom middleware: `app.Use(async (ctx, next) => { ...; await next(ctx); })` or a class with `InvokeAsync(HttpContext, RequestDelegate)`; register with `app.UseMiddleware<T>()`.
- Rate limiting: `AddRateLimiter` + `UseRateLimiter` + `RequireRateLimiting("policy")`. Output caching: `AddOutputCache` + `CacheOutput()`.

### Authentication and authorization

- JWT bearer: `AddAuthentication().AddJwtBearer(o => { o.Authority = ...; o.Audience = ...; })` or bind from `Authentication:Schemes:Bearer` in config; `RequireAuthorization()` on groups/endpoints; policies via `AddAuthorizationBuilder().AddPolicy(...)`, `RequireClaim`, requirements + `IAuthorizationHandler` for resource-based checks (`IAuthorizationService.AuthorizeAsync(user, resource, policy)`).
- Identity: `AddIdentityApiEndpoints<AppUser>().AddEntityFrameworkStores<AppDbContext>()` + `app.MapIdentityApi<AppUser>()` (.NET 8+) for token/cookie endpoints, or `AddIdentity`/`AddDefaultIdentity` with Razor Pages UI for server-rendered apps. Configure password/lockout options; use `UserManager<T>`/`SignInManager<T>` in services.
- Cookies for browser apps (`AddCookie`, antiforgery with `AddAntiforgery`/`UseAntiforgery` for forms in minimal APIs); never both cookie and bearer on the same endpoint without an explicit scheme policy.
- `HttpContext.User` claims; `ClaimsPrincipal` extension methods for `UserId()`; access via `IHttpContextAccessor` only outside handlers.

### Logging and observability

- `ILogger<T>` with structured templates: `logger.LogInformation("Order {OrderId} created for {CustomerId}", id, customerId)`; never string interpolation. `[LoggerMessage]` source generators for hot paths.
- `Logging` section in appsettings controls levels per category; Serilog or OpenTelemetry (`AddOpenTelemetry().WithTracing().WithMetrics()`) if present. Aspire `ServiceDefaults` wires OTel, health checks and resilience; call `builder.AddServiceDefaults()` when the project has it.
- Health checks at `/healthz` (liveness) and `/ready` with `Predicate` tags.

## Common tasks

### Add a feature endpoint (minimal API)

1. Request/response records in `Features/Orders/Contracts.cs`; FluentValidation validator if validators are used.
2. Service or handler with the logic; register in DI.
3. `MapXEndpoints` extension with `MapGroup`, `TypedResults`, auth and filters; call it from `Program.cs`.
4. EF query with `AsNoTracking` + projection.
5. Integration test via `WebApplicationFactory`; unit test the handler if logic is non-trivial.
6. Check `/openapi/v1.json` (or `/swagger`) for correct schema.

### Add an EF migration

```bash
dotnet ef migrations add <Name> -p src/Infrastructure -s src/Api -o Data/Migrations
dotnet ef migrations script --idempotent -o migrate.sql   # review SQL / for DBAs
dotnet ef database update -p src/Infrastructure -s src/Api
dotnet ef migrations remove ...                            # only if not applied anywhere
```

### Integration test

```csharp
public class OrdersApiTests(CustomWebAppFactory factory) : IClassFixture<CustomWebAppFactory>
{
    [Fact]
    public async Task Get_returns_404_for_missing_order()
    {
        var client = factory.CreateClient();
        var response = await client.GetAsync("/api/orders/999");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}

public class CustomWebAppFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<DbContextOptions<AppDbContext>>();
            services.AddDbContext<AppDbContext>(o => o.UseNpgsql(_container.GetConnectionString()));  // Testcontainers, or Sqlite for simple cases
            services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, TestAuthHandler>("Test", _ => { });
        });
    }
}
```

Use `IAsyncLifetime` on the factory to start a Testcontainers database and run migrations once; reset data between tests with Respawn. Prefer a real provider over the InMemory provider (it does not enforce constraints or translate queries faithfully).

### Run and build

```bash
dotnet restore && dotnet build
dotnet run --project src/Api                 # or dotnet watch run for hot reload
dotnet test
dotnet format --verify-no-changes
dotnet publish -c Release -o out             # container: dotnet publish /t:PublishContainer
```

## Pitfalls

- Scoped `DbContext` captured by a singleton (`Cannot consume scoped service`) or used concurrently (`A second operation was started on this context`).
- Tracking queries for read-only endpoints; `Include` everything then mapping in memory instead of `Select` projections.
- Forgetting `await` on EF calls or ignoring `CancellationToken`.
- Middleware ordering: `UseAuthorization` before `UseAuthentication`, or `UseCors` after endpoints.
- Returning entities with navigation cycles (JSON serialization errors); use DTOs or `ReferenceHandler.IgnoreCycles` as a last resort.
- `Database.Migrate()` at startup with multiple replicas (race conditions); `EnsureCreated()` in production.
- Hard-coded secrets in `appsettings.json`; use user secrets/env vars.
- Minimal API validation attributes silently ignored (pre-.NET 10) and `[ApiController]` conventions assumed on minimal endpoints.
- Missing `public partial class Program { }` so `WebApplicationFactory<Program>` cannot compile, or tests pointing at `Development` environment settings.
- Blocking on async (`.Result`, `.Wait()`) leading to thread pool starvation.
- Swashbuckle on .NET 9 templates: the default moved to `Microsoft.AspNetCore.OpenApi`; do not mix both unknowingly.

## Verification

```bash
dotnet build -warnaserror           # or rely on TreatWarningsAsErrors
dotnet test --collect:"XPlat Code Coverage"
dotnet format --verify-no-changes
dotnet ef migrations list -p src/Infrastructure -s src/Api
dotnet run --project src/Api        # curl -i https://localhost:<port>/healthz ; check /openapi/v1.json or /swagger
dotnet list package --outdated      # dependency hygiene
```

## References

- [references/ef-core-and-testing.md](references/ef-core-and-testing.md): DbContext lifetime, query translation tips, migration workflows and WebApplicationFactory setups with Testcontainers.
- ASP.NET Core docs: https://learn.microsoft.com/aspnet/core/
- Minimal APIs: https://learn.microsoft.com/aspnet/core/fundamentals/minimal-apis
- EF Core: https://learn.microsoft.com/ef/core/
- Integration tests: https://learn.microsoft.com/aspnet/core/test/integration-tests
- Options pattern: https://learn.microsoft.com/aspnet/core/fundamentals/configuration/options
