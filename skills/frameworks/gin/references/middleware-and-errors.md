# Gin middleware chain and error handling

## How the chain runs

```
r.Use(A, B)         // global
g := r.Group("/api", C)
g.GET("/x", D, Handler)

Request /api/x:  A -> B -> C -> D -> Handler
```

- Each middleware is `func(c *gin.Context)`. Calling `c.Next()` runs the rest of the chain synchronously; when it returns, downstream handlers are done and `c.Writer.Status()`/`c.Errors` are populated.
- Omitting `c.Next()` is fine: Gin runs the next handler automatically after the function returns. Use `c.Next()` only when you need "after" logic.
- `c.Abort()` sets the index so no further handlers run after the current one returns; combine with a response (`c.AbortWithStatusJSON`). Handlers earlier in the chain that called `c.Next()` still resume.
- `c.IsAborted()` lets "after" logic skip work.
- Middleware registered after routes does not apply to those routes.

## Request-scoped values

```go
type ctxKey string
const keyUserID ctxKey = "userID"

func SetUserID(c *gin.Context, id string) { c.Set(string(keyUserID), id) }
func UserID(c *gin.Context) string { v, _ := c.Get(string(keyUserID)); s, _ := v.(string); return s }
```

For values needed in services (tenant, user, trace id), put them in the standard context:

```go
ctx := context.WithValue(c.Request.Context(), keyUserID, id)
c.Request = c.Request.WithContext(ctx)
```

## Error middleware pattern

```go
// apperr/apperr.go
type Error struct {
    Status  int
    Code    string
    Message string
    Details any
    Err     error
}
func (e *Error) Error() string { if e.Err != nil { return e.Err.Error() }; return e.Message }
func (e *Error) Unwrap() error { return e.Err }

func NotFound(what string) *Error   { return &Error{Status: 404, Code: "not_found", Message: what + " not found"} }
func Validation(err error) *Error {
    var ve validator.ValidationErrors
    if errors.As(err, &ve) {
        details := make(map[string]string, len(ve))
        for _, fe := range ve { details[fe.Field()] = fe.Tag() }
        return &Error{Status: 400, Code: "validation_failed", Message: "validation failed", Details: details, Err: err}
    }
    return &Error{Status: 400, Code: "bad_request", Message: "malformed request", Err: err}
}
```

Handlers call `c.Error(err); return`. The `Errors()` middleware (registered before auth so it wraps everything) reads `c.Errors.Last()` after `c.Next()` and writes one response. Map domain sentinels there: `errors.Is(err, order.ErrNotFound)` -> 404, `pgconn` unique violation -> 409.

Benefits: handlers stay short, logging is centralized, and responses have one shape.

## Structured logging middleware

```go
func Logger(log *slog.Logger) gin.HandlerFunc {
    return func(c *gin.Context) {
        start := time.Now()
        c.Next()
        attrs := []slog.Attr{
            slog.String("method", c.Request.Method),
            slog.String("route", c.FullPath()),      // template, low cardinality
            slog.String("path", c.Request.URL.Path),
            slog.Int("status", c.Writer.Status()),
            slog.Duration("latency", time.Since(start)),
            slog.String("ip", c.ClientIP()),
            slog.String("request_id", c.GetString("request_id")),
        }
        if len(c.Errors) > 0 {
            attrs = append(attrs, slog.String("errors", c.Errors.String()))
        }
        level := slog.LevelInfo
        if c.Writer.Status() >= 500 { level = slog.LevelError }
        log.LogAttrs(c.Request.Context(), level, "request", attrs...)
    }
}
```

Skip `/healthz` noise with a path check at the top. `gin-contrib/sloggin` provides an equivalent ready-made middleware.

## Recovery

`gin.Recovery()` writes 500 and logs the stack. For JSON bodies and custom logging use:

```go
r.Use(gin.CustomRecovery(func(c *gin.Context, rec any) {
    slog.Error("panic", "err", rec, "stack", string(debug.Stack()))
    c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
}))
```

## Timeouts

- Server-level: `http.Server{ReadHeaderTimeout, ReadTimeout, WriteTimeout, IdleTimeout}`.
- Per-route: `github.com/gin-contrib/timeout` wraps a handler with a deadline and a timeout response. Handlers must honour `c.Request.Context()` for it to be effective at the DB layer.
- Client disconnects: watch `c.Request.Context().Done()` in long-running or streaming handlers.

## CORS

```go
r.Use(cors.New(cors.Config{
    AllowOrigins:     []string{"https://app.example.com"},
    AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE"},
    AllowHeaders:     []string{"Authorization", "Content-Type"},
    AllowCredentials: true,
    MaxAge:           12 * time.Hour,
}))
```

Register before routes; never use `AllowAllOrigins: true` together with `AllowCredentials: true`.
