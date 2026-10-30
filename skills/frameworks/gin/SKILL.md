---
name: gin
description: Build and maintain HTTP services with the Gin web framework in Go, covering routing and groups, middleware, request binding and validation (go-playground/validator), error handling, gin.Context usage, project layout, configuration, structured logging, graceful shutdown and testing with net/http/httptest. Use when a Go module requires github.com/gin-gonic/gin or when editing handlers, routers or middleware that use *gin.Context.
---

# Gin

Assumes Gin 1.9+ on Go 1.21+ (modules, `log/slog`, `context` everywhere). Gin wraps `net/http`; anything from the standard library (handlers, `http.Server`, `httptest`) still applies.

## When to use

- Adding routes, route groups, handlers, middleware, binding/validation or error responses to a Gin service.
- Structuring a Gin project (handlers/services/repositories), configuration, logging, graceful shutdown.
- Writing handler tests with `httptest`.
- Not for `net/http`-only services, Echo, Fiber or Chi (different APIs); for gRPC see the Go skill.

## Project conventions to detect first

1. Go and Gin versions in `go.mod` (`go 1.22`, `github.com/gin-gonic/gin v1.10.x`). Go 1.22+ has per-iteration loop variables and `net/http` enhanced patterns, but Gin routing is independent of them.
2. Layout: `cmd/<service>/main.go`, `internal/http/` (router, handlers, middleware), `internal/<domain>/` (service, repository), `internal/config/`, `pkg/` for shared libs; or flat `handlers/`, `models/`, `routes/` in small services. Follow what exists.
3. Dependency wiring: hand-written constructors in `main.go`, `google/wire`, `uber-go/fx`/`dig`.
4. Validation: `binding:"required,email"` tags (go-playground/validator v10 via Gin), custom validators registered through `binding.Validator.Engine()`.
5. Database: `database/sql` + `sqlx`/`pgx`, `sqlc`, `gorm`, `ent`, `bun`; migrations via `golang-migrate`, `goose`, `atlas`.
6. Config: `envconfig`/`caarlos0/env`, `viper`, `koanf`; `.env` via `godotenv` only in dev.
7. Logging: `log/slog`, `zap`, `zerolog`; whether `gin.Default()` (Logger + Recovery) or `gin.New()` with custom middleware is used.
8. Errors and responses: shared `APIError` struct, `c.Error(err)` + an error middleware, or ad-hoc `c.JSON(400, gin.H{...})`. Pick the shared pattern.
9. Tests: `testify` (`assert`/`require`/`mock`), `httptest`, table-driven tests, `gin.SetMode(gin.TestMode)` in `TestMain`, integration tests behind build tags or `testcontainers-go`.
10. Tooling: `golangci-lint` (`.golangci.yml`), `gofumpt`, `go vet`, `Makefile`/`Taskfile.yml` targets, `air` for live reload.

## Core guidance

### Router and layout

```go
// internal/http/router.go
func NewRouter(cfg config.HTTP, log *slog.Logger, orders *order.Service) *gin.Engine {
    if cfg.Env == "production" {
        gin.SetMode(gin.ReleaseMode)
    }
    r := gin.New()
    r.Use(middleware.RequestID(), middleware.Logger(log), gin.Recovery(), middleware.Errors())
    r.SetTrustedProxies(cfg.TrustedProxies) // nil disables proxy header trust; required to silence the warning

    r.GET("/healthz", func(c *gin.Context) { c.Status(http.StatusOK) })

    api := r.Group("/api/v1")
    {
        api.Use(middleware.Auth(cfg.JWTSecret))
        h := handler.NewOrders(orders)
        api.GET("/orders", h.List)
        api.POST("/orders", h.Create)
        api.GET("/orders/:id", h.Get)
    }
    return r
}
```

- Build the engine in a function that takes dependencies; `main.go` only wires config, logger, DB, services, router and the `http.Server`.
- Handlers are methods on a struct holding dependencies (`type Orders struct { svc *order.Service }`), not package-level globals.
- Route params `:id`, catch-all `*path`. Gin's tree disallows conflicting dynamic segments at the same position in older versions; since v1.8 `/users/:id` and `/users/new` may coexist, but verify with the installed version.
- `r.NoRoute(...)` and `r.NoMethod(...)` (with `r.HandleMethodNotAllowed = true`) for JSON 404/405.
- Static: `r.Static("/assets", "./public")`, `r.StaticFS`; templates via `r.LoadHTMLGlob` if server-rendered.

### Handlers, binding and validation

```go
type createOrderReq struct {
    CustomerID int64             `json:"customer_id" binding:"required,gt=0"`
    Items      []createOrderItem `json:"items" binding:"required,min=1,dive"`
    Notes      string            `json:"notes" binding:"max=1000"`
}
type createOrderItem struct {
    ProductID int64 `json:"product_id" binding:"required"`
    Quantity  int   `json:"quantity" binding:"required,min=1,max=999"`
}

func (h *Orders) Create(c *gin.Context) {
    var req createOrderReq
    if err := c.ShouldBindJSON(&req); err != nil {
        c.Error(apperr.Validation(err)) // handled by the Errors middleware
        return
    }
    userID := middleware.UserID(c)
    o, err := h.svc.Create(c.Request.Context(), userID, req.toDomain())
    if err != nil {
        c.Error(err)
        return
    }
    c.JSON(http.StatusCreated, toResponse(o))
}
```

- Use `ShouldBind*` (returns error, you decide the response) rather than `Bind*`/`MustBind*` (write 400 and abort, hard to customize). `ShouldBindUri` for path params, `ShouldBindQuery` for query, `ShouldBindJSON`, `ShouldBindWith(&v, binding.Form)`; `ShouldBindBodyWith` when the body must be read twice.
- Path params: `c.Param("id")` then `strconv.ParseInt` (or a uri struct with `uri:"id" binding:"required"`). Query: `c.Query`, `c.DefaultQuery`, `c.GetQuery`.
- Validation errors: type-assert `validator.ValidationErrors` to produce field-level messages; register custom tags once at startup:

```go
if v, ok := binding.Validator.Engine().(*validator.Validate); ok {
    v.RegisterValidation("sku", validSKU)
    v.RegisterTagNameFunc(func(f reflect.StructField) string { return strings.SplitN(f.Tag.Get("json"), ",", 2)[0] })
}
```

- Pass `c.Request.Context()` to services and DB calls so cancellations propagate; do not pass `*gin.Context` below the HTTP layer.
- Respond once: after `c.JSON`/`c.String`/`c.Status`, `return`. Use `c.AbortWithStatusJSON` in middleware to stop the chain.
- Use `c.ShouldBindJSON` with `gin.EnableJsonDecoderDisallowUnknownFields()` at startup if unknown fields must be rejected.

### Middleware

```go
func Auth(secret []byte) gin.HandlerFunc {
    return func(c *gin.Context) {
        tok := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
        claims, err := jwtx.Parse(tok, secret)
        if err != nil {
            c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
            return
        }
        c.Set(ctxUserID, claims.Subject)
        c.Next()
    }
}

func Errors() gin.HandlerFunc {
    return func(c *gin.Context) {
        c.Next()
        if len(c.Errors) == 0 || c.Writer.Written() {
            return
        }
        err := c.Errors.Last().Err
        var ae *apperr.Error
        if errors.As(err, &ae) {
            c.JSON(ae.Status, gin.H{"error": ae.Message, "details": ae.Details})
            return
        }
        slog.ErrorContext(c.Request.Context(), "unhandled error", "err", err, "path", c.FullPath())
        c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
    }
}
```

- Middleware is `gin.HandlerFunc`; call `c.Next()` to run downstream handlers (code after it runs on the way back), `c.Abort*` to stop.
- Register global middleware before routes (`r.Use`), group middleware with `group.Use` or inline `r.GET(path, mw, handler)`.
- Store per-request values with `c.Set`/`c.Get` using unexported typed keys and helper getters; for values needed by lower layers, put them into `c.Request.Context()` via `c.Request = c.Request.WithContext(ctx)`.
- Always include `gin.Recovery()` (or `gin.CustomRecovery`) so panics become 500s.
- Common third-party middleware: `github.com/gin-contrib/cors`, `gin-contrib/requestid`, `gin-contrib/gzip`, `gin-contrib/sessions`, `gin-contrib/timeout`, `gin-contrib/pprof`, `gin-contrib/zap`, `gin-contrib/sloggin`, `ulule/limiter` or `golang.org/x/time/rate` for rate limiting.
- Timeouts: `gin-contrib/timeout` or an `http.Server` with `ReadHeaderTimeout`/`ReadTimeout`/`WriteTimeout`/`IdleTimeout`; never rely on defaults.

### Errors and responses

- Define `apperr.Error{Status int, Code, Message string, Details any}` with constructors (`NotFound`, `Validation`, `Conflict`) and `Unwrap`. Services return domain errors (`ErrNotFound`); the handler or error middleware maps them with `errors.Is/As`.
- Consistent JSON envelope for errors; never leak internal error strings or SQL.
- Use `c.JSON` for responses; `c.PureJSON` to avoid HTML escaping when required; `c.Data`/`c.DataFromReader` for files; `c.SSEvent`/`c.Stream` for streaming (check `c.Writer.CloseNotify` replacement: `c.Request.Context().Done()`).

### Config, logging, lifecycle

```go
func main() {
    cfg := config.MustLoad()               // env vars -> struct, fail fast
    log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
    db := mustOpenDB(cfg.DatabaseURL)
    defer db.Close()

    r := httpx.NewRouter(cfg.HTTP, log, order.NewService(order.NewRepo(db)))
    srv := &http.Server{Addr: cfg.HTTP.Addr, Handler: r, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}

    go func() {
        if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
            log.Error("listen", "err", err); os.Exit(1)
        }
    }()

    ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer stop()
    <-ctx.Done()

    shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    if err := srv.Shutdown(shutdownCtx); err != nil {
        log.Error("shutdown", "err", err)
    }
}
```

- `GIN_MODE=release` or `gin.SetMode(gin.ReleaseMode)` in production (disables debug route printing and colored logs).
- Replace `gin.Logger()` with a structured logger middleware that records method, path (`c.FullPath()` for the route template), status, latency, request id and client IP (`c.ClientIP()`, correct only with trusted proxies set).
- Expose `/healthz` (liveness) and `/readyz` (checks DB) without auth; add `expvar`/Prometheus (`prometheus/client_golang` + `promhttp`) if the project does metrics.

## Common tasks

### Add an endpoint

1. Request/response structs with `json` and `binding` tags in the handler package.
2. Handler method: bind, call service with `c.Request.Context()`, map errors, respond.
3. Register the route in the group; add middleware if the route needs different auth.
4. Service + repository changes with context-aware DB calls.
5. Table-driven `httptest` test for 2xx, 400 (validation) and 404.

### Add middleware

1. `func Name(deps) gin.HandlerFunc` in `internal/http/middleware/`.
2. Use `c.Next()`/`c.Abort*` correctly; store values with typed keys and accessor helpers.
3. Register at the right scope; add a test that asserts abort behaviour and header/context effects.

### Test a handler

```go
func TestMain(m *testing.M) { gin.SetMode(gin.TestMode); os.Exit(m.Run()) }

func TestCreateOrder(t *testing.T) {
    svc := &fakeOrderService{}            // or testify mock
    r := NewRouter(testCfg, slog.Default(), svc)

    body := `{"customer_id":1,"items":[{"product_id":2,"quantity":1}]}`
    req := httptest.NewRequest(http.MethodPost, "/api/v1/orders", strings.NewReader(body))
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("Authorization", "Bearer "+testToken(t))
    rec := httptest.NewRecorder()

    r.ServeHTTP(rec, req)

    require.Equal(t, http.StatusCreated, rec.Code)
    var got orderResponse
    require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
    assert.Equal(t, int64(1), got.CustomerID)
}
```

To test a single handler without the router: `c, rec := gin.CreateTestContext(httptest.NewRecorder()); c.Request = req; c.Params = gin.Params{{Key: "id", Value: "1"}}; h.Get(c)`. Prefer going through the router so middleware and binding are exercised.

### Add a custom validator

1. Register in router setup via `binding.Validator.Engine()`.
2. Use the tag in struct fields; cover with a binding test.

## Pitfalls

- Using `*gin.Context` in goroutines after the handler returned; copy with `c.Copy()` for async work and never write the response from the goroutine.
- Passing `*gin.Context` to services instead of `c.Request.Context()`.
- Not returning after `c.JSON`/`c.Abort*`, causing double writes (`[WARNING] Headers were already written`).
- Missing `gin.Recovery()` when using `gin.New()`; panics kill the request without a response.
- Trusting `X-Forwarded-For` without `SetTrustedProxies` (spoofed `ClientIP`), or leaving the default trust-all warning in production.
- `gin.Default()` logging in release builds flooding stdout with unstructured lines.
- Binding into structs without `binding` tags, assuming required fields are enforced.
- `c.Query` values treated as ints without parsing; `c.Param` collisions with static routes.
- Global `var db *sql.DB` and package-level handlers that make tests order-dependent.
- Relying on `http.Server` defaults (no timeouts) and `ListenAndServe` without graceful shutdown.
- Forgetting `gin.SetMode(gin.TestMode)` in tests (noisy output) or `gin.ReleaseMode` in production.

## Verification

```bash
go build ./... && go vet ./...
golangci-lint run                 # if .golangci.yml exists
go test ./... -race -cover
go run ./cmd/<service>            # then curl -i localhost:8080/healthz
go mod tidy && git diff --exit-code go.mod go.sum
make test / task test             # discover repo targets: make -n, task --list
```

## References

- [references/middleware-and-errors.md](references/middleware-and-errors.md): middleware chain semantics, error-middleware pattern and structured logging middleware.
- Gin docs: https://gin-gonic.com/docs/
- Gin API reference: https://pkg.go.dev/github.com/gin-gonic/gin
- validator tags: https://pkg.go.dev/github.com/go-playground/validator/v10
- gin-contrib middleware: https://github.com/gin-contrib
- Graceful shutdown example: https://github.com/gin-gonic/examples/tree/master/graceful-shutdown
