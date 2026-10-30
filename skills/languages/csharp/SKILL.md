---
name: csharp
description: Write, refactor and review C# 12 on .NET 8 (class libraries, ASP.NET Core, console apps, workers). Covers project/solution structure, nullable reference types, async/await, records, pattern matching, LINQ, dependency injection, xUnit/NUnit testing, the dotnet CLI, and analyzers/.editorconfig. Use when editing .cs files or a project with .csproj, .sln or global.json.
---

# C# / .NET

Assumes C# 12 and .NET 8 (LTS). Older target frameworks (`net6.0`, `netstandard2.0`) lose some syntax; check `<TargetFramework>` and `<LangVersion>` before using primary constructors or collection expressions.

## When to use

- Editing or creating `.cs` files, `.csproj`, `.sln`, `Directory.Build.props`, `Directory.Packages.props`, `global.json`.
- Adding NuGet packages, projects, tests, analyzers or build configuration.
- Reviewing C# for nullability, async correctness, allocation or API design.

## Project conventions to detect first

1. `*.csproj` / `Directory.Build.props`: `TargetFramework(s)`, `Nullable` (`enable`?), `ImplicitUsings`, `LangVersion`, `TreatWarningsAsErrors`, `EnforceCodeStyleInBuild`, `IsPackable`. If `Nullable` is disabled, do not sprinkle `?` annotations randomly; propose enabling it per project.
2. `Directory.Packages.props` with `ManagePackageVersionsCentrally=true`: add versions there, not in the `.csproj`.
3. `global.json`: pinned SDK version; use `dotnet --version` to confirm it is installed.
4. `.editorconfig`: naming rules (`_camelCase` private fields, `PascalCase` everything public), `var` preference, `dotnet_diagnostic.*` severities, file-scoped namespaces.
5. Test framework: look for `xunit`, `NUnit`, `MSTest.TestFramework` package references and `FluentAssertions`, `NSubstitute`/`Moq`, `Shouldly`.
6. Layout: `src/` + `tests/` with one project per assembly is the norm; test project named `<Project>.Tests`.
7. Hosting: `Program.cs` top-level statements with `WebApplication.CreateBuilder` (ASP.NET Core) or `Host.CreateApplicationBuilder` (workers); minimal APIs vs controllers; `appsettings.json` + `IOptions<T>`.

## Core guidance

### Nullable reference types

- Keep `<Nullable>enable</Nullable>`. Fix warnings; never silence with `!` unless you can state why the value is non-null (prefer a guard or `ArgumentNullException.ThrowIfNull(x)`).
- Annotate honestly: `string?` for maybe-null, `[NotNullWhen(true)]`, `[MaybeNullWhen(false)]`, `[MemberNotNull]` for try-patterns and init helpers.
- `required` members for properties that must be set in an object initializer:

```csharp
public sealed class CreateOrder
{
    public required string CustomerId { get; init; }
    public required IReadOnlyList<OrderLine> Lines { get; init; }
    public string? Note { get; init; }
}
```

### Types and immutability

- Use `record` (reference) or `record struct` for data carriers with value equality; `readonly record struct` for small immutable values. Use `with` for copies.
- Prefer `sealed` classes by default; `internal` by default, `public` only for the real API surface.
- Primary constructors (C# 12) for DI-style classes: `public sealed class OrderService(IOrderRepository repo, ILogger<OrderService> logger)`.
- Collection expressions (C# 12): `int[] xs = [1, 2, 3];`, `List<string> names = [..first, ..second];`.
- Expose `IReadOnlyList<T>` / `IReadOnlyDictionary<K,V>` / `IEnumerable<T>` from public APIs, not `List<T>`.
- Pattern matching over type checks and nested ifs:

```csharp
return shape switch
{
    Circle { Radius: var r } => Math.PI * r * r,
    Rectangle(var w, var h) => w * h,
    _ => throw new ArgumentOutOfRangeException(nameof(shape)),
};
```

### Async

- `async Task` / `async Task<T>`; `async void` only for event handlers. Suffix async methods with `Async`.
- Accept `CancellationToken cancellationToken = default` as the last parameter and pass it through to every awaited call.
- Library code: `ConfigureAwait(false)`; application code (ASP.NET Core, console) does not need it.
- Never block: no `.Result`, `.Wait()`, `GetAwaiter().GetResult()`. Use `await Task.WhenAll(...)` for parallel independent work.
- `ValueTask<T>` only on hot paths that frequently complete synchronously; await it exactly once.
- Streams of results: `IAsyncEnumerable<T>` + `await foreach` with `[EnumeratorCancellation]`.

### LINQ and collections

- LINQ for querying; plain loops for hot paths with measurable cost. Avoid multiple enumeration: materialise with `.ToList()`/`.ToArray()` once when you iterate more than once.
- Prefer `Any()` over `Count() > 0`; `TryGetValue` over `ContainsKey` + indexer; `FirstOrDefault` with a predicate.
- Entity Framework Core: keep queries `IQueryable` until the final `ToListAsync(ct)`; avoid client evaluation and N+1 (use `Include`/projections with `Select`).

### Dependency injection and configuration

- Register in `Program.cs` (or an `AddXxx` extension method in the library): `services.AddScoped<IOrderService, OrderService>()`. Lifetimes: Singleton (stateless, thread-safe), Scoped (per request/unit of work), Transient (cheap, stateless).
- Do not inject `IServiceProvider` (service locator). Do not capture a Scoped service inside a Singleton; use `IServiceScopeFactory` in background services.
- Strongly typed configuration: `services.Configure<SmtpOptions>(config.GetSection("Smtp"))` and inject `IOptions<SmtpOptions>` (or `IOptionsMonitor` for reloads). Validate with `.ValidateDataAnnotations().ValidateOnStart()`.
- `HttpClient` through `IHttpClientFactory` / typed clients, never `new HttpClient()` per call.
- Logging: `ILogger<T>` with structured message templates: `logger.LogInformation("Order {OrderId} shipped", id)`, not string interpolation. Consider `[LoggerMessage]` source generators on hot paths.

### Errors

- Throw specific exceptions (`ArgumentException`, `InvalidOperationException`, domain exceptions deriving from `Exception`). Use the `Throw*` helpers: `ArgumentNullException.ThrowIfNull`, `ArgumentOutOfRangeException.ThrowIfNegative`, `ObjectDisposedException.ThrowIf`.
- Do not catch `Exception` except at a boundary that logs and converts (middleware, worker loop). Use `when` filters: `catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.NotFound)`.
- Expected failures in domain code: a `Result`/`OneOf`-style type if the repo already uses one; otherwise exceptions.
- `IDisposable`/`IAsyncDisposable`: `using var x = ...;` / `await using`. Implement `Dispose` for classes owning unmanaged or disposable resources only.

### Style

- File-scoped namespaces (`namespace Foo.Bar;`), one type per file, `var` when the type is obvious on the right-hand side (follow `.editorconfig`).
- Use `nameof`, string interpolation with `$"..."`, raw string literals `"""..."""` for multi-line/JSON.
- `System.Text.Json` over Newtonsoft for new code; configure once via `JsonSerializerOptions` and reuse the instance.
- Use `DateTimeOffset` / `TimeProvider` (.NET 8) instead of `DateTime.Now` so tests can control time.

## Common tasks

### Create a solution with a library and tests

```bash
dotnet new sln -n MyApp
dotnet new classlib -n MyApp.Core -o src/MyApp.Core
dotnet new xunit -n MyApp.Core.Tests -o tests/MyApp.Core.Tests
dotnet sln add src/MyApp.Core tests/MyApp.Core.Tests
dotnet add tests/MyApp.Core.Tests reference src/MyApp.Core
dotnet add tests/MyApp.Core.Tests package FluentAssertions
```

### Add a NuGet package

- `dotnet add <project> package <Name>`; with central package management, add `<PackageVersion Include="Name" Version="x.y.z" />` to `Directory.Packages.props` and an unversioned `<PackageReference Include="Name" />` to the project.
- Check for vulnerable/outdated packages: `dotnet list package --vulnerable`, `dotnet list package --outdated`.

### Write a test (xUnit)

```csharp
public sealed class OrderServiceTests
{
    [Fact]
    public async Task PlaceAsync_WithEmptyLines_Throws()
    {
        var repo = Substitute.For<IOrderRepository>();
        var sut = new OrderService(repo, NullLogger<OrderService>.Instance);

        var act = () => sut.PlaceAsync(new CreateOrder { CustomerId = "c1", Lines = [] }, CancellationToken.None);

        await act.Should().ThrowAsync<ArgumentException>();
    }

    [Theory]
    [InlineData(1, 2, 3)]
    [InlineData(0, 0, 0)]
    public void Add_Works(int a, int b, int expected) => Calculator.Add(a, b).Should().Be(expected);
}
```

NUnit equivalents: `[TestFixture]`, `[Test]`, `[TestCase(...)]`, `Assert.That(x, Is.EqualTo(y))`. Integration tests for ASP.NET Core: `WebApplicationFactory<Program>` from `Microsoft.AspNetCore.Mvc.Testing` (add `public partial class Program {}` to `Program.cs`).

### Add a minimal API endpoint

```csharp
app.MapPost("/orders", async (CreateOrder req, IOrderService svc, CancellationToken ct) =>
{
    var id = await svc.PlaceAsync(req, ct);
    return Results.Created($"/orders/{id}", new { id });
})
.WithName("CreateOrder");
```

Group endpoints with `app.MapGroup("/orders")` and put them in a static `MapOrderEndpoints(this IEndpointRouteBuilder)` extension.

### Add a background service

Derive from `BackgroundService`, override `ExecuteAsync(CancellationToken stoppingToken)`, loop with `PeriodicTimer`, honour the token, create a scope per iteration via `IServiceScopeFactory`. Register with `services.AddHostedService<T>()`.

### Enable analyzers

In `Directory.Build.props`:

```xml
<PropertyGroup>
  <Nullable>enable</Nullable>
  <ImplicitUsings>enable</ImplicitUsings>
  <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  <AnalysisLevel>latest-recommended</AnalysisLevel>
  <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
</PropertyGroup>
```

Tune individual rules in `.editorconfig` (`dotnet_diagnostic.CA1848.severity = none`). Popular extra analyzers: `Roslynator.Analyzers`, `SonarAnalyzer.CSharp`, `Meziantou.Analyzer`.

## Pitfalls

- `async void` outside event handlers swallows exceptions and cannot be awaited.
- Forgetting to pass `CancellationToken` through, or creating a fresh `CancellationTokenSource` without disposing it.
- Capturing `foreach` variables / `this` in long-lived lambdas registered in DI singletons (memory leaks).
- `struct` with mutable fields, or large structs passed by value in hot loops; use `readonly struct` and `in` parameters.
- String comparison without `StringComparison.Ordinal`/`OrdinalIgnoreCase`; culture-dependent `ToLower()` for keys.
- `DateTime.Now` in domain logic; use `DateTimeOffset.UtcNow` or `TimeProvider`.
- Returning `null` for collections; return empty (`[]`, `Array.Empty<T>()`).
- `IEnumerable<T>` from EF Core queries enumerated more than once hits the database twice.
- Mixing `Microsoft.Extensions.*` package versions across major .NET versions in one solution.
- Editing `bin/` or `obj/` artifacts, or committing them; they are build output.

## Verification

```bash
dotnet --version                     # matches global.json?
dotnet restore
dotnet build -warnaserror            # or rely on TreatWarningsAsErrors
dotnet format --verify-no-changes    # style + analyzers from .editorconfig
dotnet test                          # all test projects in the solution
dotnet test --filter "FullyQualifiedName~OrderService"   # subset
dotnet run --project src/MyApp.Api   # smoke-run the host
```

Check `*.csproj`/`Directory.Build.props` for custom targets and the CI workflow (`.github/workflows/*.yml`, `azure-pipelines.yml`) for the exact commands the project considers green.

## References

- C# language reference: https://learn.microsoft.com/dotnet/csharp/
- What's new in C# 12: https://learn.microsoft.com/dotnet/csharp/whats-new/csharp-12
- Nullable reference types: https://learn.microsoft.com/dotnet/csharp/nullable-references
- .NET dependency injection: https://learn.microsoft.com/dotnet/core/extensions/dependency-injection
- dotnet CLI: https://learn.microsoft.com/dotnet/core/tools/
- Code analysis rules: https://learn.microsoft.com/dotnet/fundamentals/code-analysis/quality-rules/
- xUnit: https://xunit.net/docs/getting-started/v2/getting-started
