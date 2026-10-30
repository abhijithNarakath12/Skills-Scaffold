---
name: go
description: Write, refactor and review Go (1.22+) services, CLIs and libraries. Covers modules and project layout, error wrapping and sentinel errors, context propagation, goroutines/channels/sync, generics, table-driven tests with the testing package, and the tooling loop (gofmt, go vet, staticcheck, golangci-lint). Use when editing .go files or a project with go.mod.
---

# Go

Assumes Go 1.22+ (per-iteration loop variables, `range` over integers, `log/slog`, `math/rand/v2`). Check the `go` directive in `go.mod` before using newer features (`range` over functions and `iter` package need 1.23; `testing.B.Loop` needs 1.24).

## When to use

- Editing or creating `.go` files, `go.mod`/`go.sum`, `go.work`.
- Adding dependencies, restructuring packages, writing tests or benchmarks.
- Reviewing Go for error handling, concurrency safety, context use or API shape.

## Project conventions to detect first

Before writing code, check:

1. `go.mod`: module path (import prefix for every internal package), `go` version directive, `toolchain`, `replace` directives, whether it is a workspace (`go.work`).
2. **Layout**: `cmd/<binary>/main.go` for entry points, `internal/` for private packages, `pkg/` (only if already used), flat single-package repos for small libraries. Follow what exists; do not introduce `pkg/` or `internal/` into a flat repo without reason.
3. **Lint config**: `.golangci.yml`/`.golangci.yaml` (enabled linters, line length, exclusions), `staticcheck.conf`. Run the configured linter; do not change its config to pass.
4. **Build/tooling**: `Makefile`, `Taskfile.yml`, `magefile.go`, `tools.go` or `go.mod` `tool` directives (1.24), `//go:generate` lines, `Dockerfile`, CI workflow.
5. **Existing style**: how errors are wrapped (`fmt.Errorf("...: %w")`, custom error types), logging library (`log/slog`, `zap`, `zerolog`, `logrus`), config loading, DI style (constructors vs wire/fx), HTTP router (`net/http` 1.22 patterns, chi, gin, echo), DB layer (`database/sql`, `sqlc`, `gorm`, `pgx`), test helpers (`testify`, plain `testing`, `go-cmp`).

## Core guidance

### Packages and layout

- One concept per package; package name is short, lowercase, no underscores, and is not repeated in identifiers (`http.Client`, not `http.HTTPClient`).
- Avoid `util`, `common`, `helpers` packages. Put code next to its only consumer; promote to a shared package when a second consumer appears.
- Keep `main` tiny: parse flags/env, build dependencies, call `run(ctx, args) error`, exit with code on error.
- No `init()` for business logic; no package-level mutable state. Pass dependencies through constructors (`NewServer(db *sql.DB, log *slog.Logger) *Server`).
- Accept interfaces, return structs. Define interfaces in the consuming package, keep them small (1-3 methods).
- Exported identifiers need doc comments starting with the identifier name.

### Errors

- Return errors; never panic for expected failures. `panic` only for programmer errors (invariant violations) and in `main`/`init` for unrecoverable startup problems.
- Wrap with context and `%w` so callers can `errors.Is`/`errors.As`; message is lowercase, no trailing punctuation, says what was attempted:

```go
if err := store.Save(ctx, user); err != nil {
    return fmt.Errorf("save user %s: %w", user.ID, err)
}
```

- Sentinel errors as package-level `var ErrNotFound = errors.New("not found")`; typed errors (`type ValidationError struct{...}` with `Error()`) when callers need fields. Check with `errors.Is(err, ErrNotFound)` / `var ve *ValidationError; errors.As(err, &ve)`.
- Handle an error exactly once: either log it or return it, not both.
- `errors.Join` to combine multiple errors (e.g. cleanup failures); `defer` closers that can fail should capture the error into a named return.
- Do not compare `err.Error()` strings. Do not use `err == ErrX` when wrapping is possible; use `errors.Is`.

### Context

- `ctx context.Context` is the first parameter of every function that does I/O, blocks, or spawns goroutines. Never store it in a struct (except request-scoped types like `http.Request`).
- Derive with `context.WithTimeout`/`WithCancel`/`WithCancelCause` and always `defer cancel()`.
- Check `ctx.Err()` in long loops; pass `ctx` to `database/sql`, `net/http` (`http.NewRequestWithContext`), `exec.CommandContext`.
- Use `context.WithValue` only for request-scoped metadata (trace IDs, auth principal) with unexported key types, never for passing dependencies.

### Concurrency

- Do not start a goroutine without knowing how it stops. Tie lifetime to a `ctx`, a `sync.WaitGroup`, or `errgroup.Group` (`golang.org/x/sync/errgroup`):

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(8)
for _, item := range items {
    g.Go(func() error { return process(ctx, item) }) // 1.22: item is per-iteration
}
if err := g.Wait(); err != nil { return err }
```

- Channels: the sender closes; close exactly once; `select` with `ctx.Done()` on every blocking send/receive. Unbuffered by default; buffer sizes need a justification.
- Protect shared state with `sync.Mutex` (embed as a value, not a pointer; keep critical sections small) or use `sync.Map`/`atomic` only for the specific patterns they fit.
- `sync.Once`/`sync.OnceValue` (1.21) for lazy init. `time.AfterFunc`/`time.NewTimer` with `Stop` for cancellable timers; `time.Tick` leaks, use `time.NewTicker` + `defer t.Stop()`.
- Always run tests with `-race` when touching concurrent code.

### Generics

- Use type parameters for containers and algorithms (`Map[K comparable, V any]`, `func Filter[T any](s []T, keep func(T) bool) []T`), not to replace interfaces for behaviour.
- Prefer stdlib generics: `slices` (`Sort`, `SortFunc`, `Contains`, `Index`, `BinarySearch`), `maps` (`Keys`, `Values` return iterators in 1.23), `cmp.Compare`, `min`/`max`/`clear` builtins (1.21).
- Constraints: `comparable`, `cmp.Ordered`, or small interfaces; avoid `golang.org/x/exp/constraints` in new code.

### Standard library first

- HTTP: `net/http` with 1.22 method-aware patterns (`mux.HandleFunc("GET /users/{id}", h)`, `r.PathValue("id")`). Set `ReadHeaderTimeout` on servers; use `http.Client` with timeouts, never `http.DefaultClient` for production calls.
- JSON: `encoding/json` with struct tags (`json:"name,omitempty"`); decode into typed structs; `json.NewDecoder(r.Body)` for requests. Use `DisallowUnknownFields` when strictness matters.
- Logging: `log/slog` with structured key-value pairs (`slog.Info("saved", "user", id)`); pass `*slog.Logger` in, or use `slog.Default()` only in `main`.
- Time: `time.Duration` constants (`5 * time.Second`), `time.Now().UTC()`, `time.Since`. Monotonic comparisons via `t.Sub`.
- Random: `math/rand/v2` for non-crypto; `crypto/rand` for secrets.
- Strings: `strings.Builder` for concatenation in loops; `strconv` not `fmt.Sprint` for conversions.

## Common tasks

### Add a dependency

```bash
go get github.com/org/pkg@latest   # or @v1.2.3
go mod tidy                        # prune and sync go.sum
```

Commit `go.mod` and `go.sum` together. Prefer stdlib or `golang.org/x/*` over third-party when equivalent.

### Add a package

1. Create `internal/<name>/<name>.go` (or next to its consumer); `package <name>` matching the directory.
2. Export a constructor and the minimal interface; keep fields unexported with accessor methods only when needed.
3. Add `<name>_test.go` in the same package (white-box) or `package <name>_test` (black-box, preferred for public API).
4. Run `gofmt`, `go vet ./...`, `go test ./...`.

### Write table-driven tests

```go
func TestParse(t *testing.T) {
    t.Parallel()
    tests := []struct {
        name    string
        in      string
        want    Config
        wantErr error
    }{
        {name: "empty", in: "", wantErr: ErrEmpty},
        {name: "valid", in: "a=1", want: Config{A: 1}},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel()
            got, err := Parse(tt.in)
            if !errors.Is(err, tt.wantErr) {
                t.Fatalf("Parse(%q) error = %v, want %v", tt.in, err, tt.wantErr)
            }
            if diff := cmp.Diff(tt.want, got); diff != "" {
                t.Errorf("Parse(%q) mismatch (-want +got):\n%s", tt.in, diff)
            }
        })
    }
}
```

- `t.Helper()` in helpers, `t.Cleanup` for teardown, `t.TempDir()` for files, `t.Setenv` for env (not with `t.Parallel`).
- `testing/fstest`, `net/http/httptest`, `testing/synctest` (1.25) for I/O; `go-cmp` or `testify` only if already a dependency.
- Golden files under `testdata/`; update with an `-update` flag you define, never by hand.
- Benchmarks: `func BenchmarkX(b *testing.B)` with `for b.Loop()` (1.24) or `for range b.N`; run `go test -bench=. -benchmem ./pkg`.

### Add an HTTP endpoint (net/http 1.22+)

1. Handler as a method on a struct holding dependencies, or a func returning `http.Handler`.
2. Register `mux.Handle("POST /items", h)`; read path values with `r.PathValue`.
3. Decode request body with limits (`http.MaxBytesReader`), validate, call the service with `r.Context()`.
4. Write errors through one helper that maps domain errors (`errors.Is`) to status codes; never leak internal messages.
5. Test with `httptest.NewRecorder` and `httptest.NewRequest`.

### Run code generation

- `go generate ./...` runs `//go:generate` directives (mocks, stringer, sqlc, protobuf). Commit generated files unless the repo ignores them. Check whether generation is reproducible before editing generated code by hand (never do that).

### Upgrade the Go version

1. Bump `go` in `go.mod` (`go mod edit -go=1.23`); check `toolchain` directive and CI images.
2. Run `go vet ./...`, `go test ./...`, then `go fix ./...` if suggested.
3. Replace deprecated APIs flagged by `staticcheck`.

## Pitfalls

- Ignoring returned errors (`_ = f()` without comment, or not checking `Close()`/`Write()` results where it matters).
- Shadowing `err` with `:=` inside `if`/`for` blocks so the outer error is never set; the `shadow` analyzer (`go run golang.org/x/tools/go/analysis/passes/shadow/cmd/shadow@latest ./...`) or golangci-lint `govet` with `shadow` enabled catches these.
- Loop variable capture: fixed for `for` loops in 1.22+, but only when `go.mod` says `go 1.22` or higher.
- Nil interface vs nil pointer: returning a typed nil pointer as an `error` interface is non-nil. Return a literal `nil`.
- Slices share backing arrays; `append` may or may not reallocate. Copy with `slices.Clone` before handing out internal slices.
- Map iteration order is random; sort keys for deterministic output (`slices.Sorted(maps.Keys(m))` in 1.23).
- Goroutine leaks from blocked channel operations without `ctx.Done()` select, or `time.After` in loops.
- Holding a mutex across I/O or across a function call that may re-lock it (deadlock).
- Using `log.Fatal` outside `main`; it skips deferred cleanup.
- Large structs passed by value in hot paths; pointer receivers mixed with value receivers on the same type (pick one, usually pointer if any method mutates).
- `defer` inside loops delays until function exit; wrap the loop body in a function.
- `http.Get` without a timeout; `resp.Body` not closed; not draining the body before reuse.
- Exporting types/functions that only one package uses; exported surface is an API commitment.
- `interface{}`: write `any`. Empty-interface parameters hide bugs; use generics or concrete types.
- Comparing times with `==`; use `t.Equal`.

## Verification

Discover commands in `Makefile`/`Taskfile.yml`/CI; typical loop:

```bash
gofmt -l . && gofmt -w .          # or: goimports -w .
go vet ./...
staticcheck ./...                 # if installed (go install honnef.co/go/tools/cmd/staticcheck@latest)
golangci-lint run                 # if .golangci.yml exists
go build ./...
go test -race -cover ./...
go mod tidy && git diff --exit-code go.mod go.sum   # confirm module files are clean
```

Run `go test -run 'TestName' ./pkg/...` for a focused loop, `-v` for output, `-count=1` to bypass the cache. `go vet` must pass with zero findings; treat lint findings as errors unless the config excludes them.

## References

- Effective Go: https://go.dev/doc/effective_go
- Go Code Review Comments: https://go.dev/wiki/CodeReviewComments
- Google Go Style Guide: https://google.github.io/styleguide/go/
- Modules reference: https://go.dev/ref/mod
- Standard library: https://pkg.go.dev/std
- Errors (`errors.Is/As/Join`): https://pkg.go.dev/errors
- net/http routing patterns (1.22): https://go.dev/blog/routing-enhancements
- staticcheck checks: https://staticcheck.dev/docs/checks/
- golangci-lint linters: https://golangci-lint.run/usage/linters/
