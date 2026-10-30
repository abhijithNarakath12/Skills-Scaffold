---
name: rust
description: Write, refactor and review stable Rust (2021 edition, 1.75+) crates, binaries and services. Covers cargo workspaces and features, ownership/borrowing decisions, error handling with thiserror and anyhow, traits and generics, async with tokio, clippy/rustfmt, and unit/integration tests. Use when editing .rs files or a project with Cargo.toml.
---

# Rust

Assumes stable Rust on the 2021 edition with a recent toolchain (1.75+: `async fn` in traits, `impl Trait` in return position of trait methods). Check `rust-toolchain.toml` and `rust-version` in `Cargo.toml` before using newer features; if `edition = "2024"` is set, `unsafe extern`, `let chains` and `RPIT` capture rules differ.

## When to use

- Editing or creating `.rs` files, `Cargo.toml`, `Cargo.lock`, `build.rs`, `rust-toolchain.toml`, `clippy.toml`, `rustfmt.toml`.
- Adding crates, restructuring modules, designing public APIs, writing tests or benchmarks.
- Reviewing Rust for ownership, error handling, unsafe usage or async correctness.

## Project conventions to detect first

Before writing code, check:

1. `Cargo.toml`: `[workspace]` members and `[workspace.dependencies]`, `edition`, `rust-version` (MSRV), `[features]` and `default` features, `[lib]`/`[[bin]]` targets, `[profile.*]`. In a workspace, add shared deps to the root and use `dep = { workspace = true }` in members.
2. **Error strategy**: `thiserror` (typed errors in libraries), `anyhow`/`eyre` (applications), custom enums, or `Box<dyn Error>`. Match the crate's choice; libraries expose typed errors, binaries may use `anyhow`.
3. **Async runtime**: `tokio` (features enabled, `#[tokio::main]` flavor), `async-std`, `smol`, or none. Never mix runtimes. Note whether the project uses `tokio::sync` vs `std::sync` primitives.
4. **Lint config**: `[lints.rust]`/`[lints.clippy]` in `Cargo.toml` (1.74+), `clippy.toml`, `#![deny(...)]`/`#![warn(...)]` in `lib.rs`/`main.rs`, `rustfmt.toml`. Run the configured level; do not `#[allow]` to silence without a reason.
5. **Module layout**: `src/lib.rs` + thin `src/main.rs`, `mod.rs` files vs `foo.rs` + `foo/` directory (2018+ style, preferred), where tests live (`#[cfg(test)]` inline, `tests/` integration).
6. **Existing style**: serde usage (`derive`, `rename_all`), logging (`tracing` vs `log`), CLI parsing (`clap` derive), builder patterns, `pub(crate)` discipline, `unsafe` policy (`#![forbid(unsafe_code)]`).

## Core guidance

### Ownership and borrowing (decision rules)

- Take parameters by reference unless the function needs ownership (stores it, moves it into a thread/task, or consumes it). `&str` over `&String`, `&[T]` over `&Vec<T>`, `impl AsRef<Path>` for paths, `impl Into<String>` only on constructors.
- Return owned values (`String`, `Vec<T>`) from functions that create data; return references only when the output borrows from an input and lifetimes are obvious (`fn first<'a>(s: &'a str) -> &'a str`).
- Clone deliberately. A `.clone()` to satisfy the borrow checker is acceptable in cold paths; mark it with a comment if it is a known trade-off. In hot paths, restructure (split borrows, use indices, take ownership) instead.
- Use `Rc<RefCell<T>>` only in single-threaded graphs; `Arc<Mutex<T>>`/`Arc<RwLock<T>>` across threads. Prefer message passing (`mpsc`, `tokio::sync::mpsc`) or immutable `Arc<T>` when state does not need mutation.
- Avoid lifetimes in struct fields unless the struct is a short-lived view (iterator, parser). Owned fields make APIs easier; use `Cow<'a, str>` when sometimes borrowing is worth it.
- Prefer iterators and combinators (`iter().filter().map().collect()`) over index loops; use `collect::<Result<Vec<_>, _>>()` to propagate errors in a chain.
- Let the compiler guide you: when a borrow error appears, first consider whether two mutable paths exist to the same data; the fix is usually scoping (`{ }` blocks), `split_at_mut`, `std::mem::take`/`replace`, or `entry` API on maps.

### Types and traits

- Make invalid states unrepresentable: enums with data over bools and `Option` combinations; newtypes (`struct UserId(Uuid)`) for ids and units.
- Derive liberally: `#[derive(Debug, Clone, PartialEq, Eq, Hash, Default)]`; add `Copy` for small plain data; `serde::{Serialize, Deserialize}` where crossing boundaries.
- Implement standard traits instead of custom methods: `Display` (not `to_string` method), `FromStr`, `From`/`TryFrom` for conversions, `Iterator` for sequences, `Default` for config.
- Generics with trait bounds for static dispatch in libraries and hot paths; `dyn Trait` (`Box<dyn Trait>`, `&dyn Trait`) when you need heterogeneous collections or to reduce monomorphization. Use `where` clauses when bounds get long.
- Keep public API small: `pub(crate)` by default, `pub` only for intended surface. Add `#[non_exhaustive]` to public enums/structs you may extend.
- Builders for structs with many optional fields; `Default` + struct update syntax (`Config { port: 8080, ..Default::default() }`) for simple cases.

### Error handling

- Libraries: one error enum per module or crate with `thiserror`:

```rust
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("record {0} not found")]
    NotFound(String),
    #[error("database error")]
    Db(#[from] sqlx::Error),
    #[error("invalid config: {reason}")]
    Config { reason: String },
}
pub type Result<T, E = StoreError> = std::result::Result<T, E>;
```

- Applications: `anyhow::Result<T>` with `.context("reading config")?` / `.with_context(|| format!("opening {path}"))?`; `anyhow::bail!`/`ensure!` for early exits. `main` returns `anyhow::Result<()>`.
- Use `?` everywhere; avoid `.unwrap()`/`.expect()` outside tests, `main` setup, and provably infallible cases (document why with `expect("...invariant...")`).
- `Option` for absence, `Result` for failure. Do not convert errors to `Option` with `.ok()` unless the error is truly irrelevant.
- Never `panic!` in library code paths reachable by callers; return errors. `unreachable!()`/`debug_assert!` for invariants.

### Async (tokio)

- `#[tokio::main]` on `main` only; libraries expose `async fn` and never create a runtime.
- Do not block the executor: use `tokio::fs`, `tokio::net`, `tokio::time::sleep`; wrap sync CPU work with `tokio::task::spawn_blocking`.
- Spawned tasks need `'static` + `Send` data: clone `Arc`s before `tokio::spawn(async move { ... })`. Hold `std::sync::Mutex` guards only across non-`.await` sections; use `tokio::sync::Mutex` when a lock must span an `.await`.
- Structured concurrency: `tokio::join!`/`try_join!` for fixed sets, `JoinSet` for dynamic sets, `tokio::select!` with cancellation-safe branches (check docs of each future; many `recv()` methods are safe, `read_exact` is not).
- Propagate cancellation with `tokio_util::sync::CancellationToken` or by dropping futures; add `tokio::time::timeout` to external calls.
- Make streams with `futures::Stream`/`tokio_stream`; avoid hand-rolled `Future` impls unless building a library primitive.

### Unsafe

- Avoid. If unavoidable, isolate in a tiny module, add `// SAFETY:` comments stating the invariants, keep a safe wrapper public, and run `cargo miri test` if available. Respect `#![forbid(unsafe_code)]` where present.

## Common tasks

### Add a dependency

```bash
cargo add serde --features derive
cargo add tokio --features macros,rt-multi-thread
cargo add --dev proptest
cargo remove old-crate
```

In a workspace, add to `[workspace.dependencies]` at the root and reference with `serde = { workspace = true }`. Keep default features minimal (`default-features = false` + explicit list) in libraries.

### Add a module

1. Create `src/<name>.rs` (and `src/<name>/` for submodules); declare `mod <name>;` in `lib.rs` or the parent module. Re-export the public surface with `pub use`.
2. Keep items `pub(crate)` unless they are API. Document `pub` items with `///` including an `# Examples` section where practical (doctests run in `cargo test`).
3. Add `#[cfg(test)] mod tests { use super::*; ... }` at the bottom.
4. Run `cargo fmt`, `cargo clippy --all-targets`, `cargo test`.

### Write tests

- Unit: inline `#[cfg(test)]` module; `#[test]`, `assert_eq!`, `assert!(matches!(x, Pattern))`, `#[should_panic(expected = "...")]` sparingly; tests may return `Result<(), Box<dyn Error>>` and use `?`.
- Integration: `tests/<feature>.rs` uses only the public API; shared helpers in `tests/common/mod.rs`.
- Async tests: `#[tokio::test]` (needs `tokio` `macros` + `rt` features as dev-dependency); `#[tokio::test(start_paused = true)]` with `tokio::time::advance` for timers.
- Property tests with `proptest` or `quickcheck`; snapshot tests with `insta` (`cargo insta review`), only if already in the repo.
- Run: `cargo test`, `cargo test <name_filter>`, `cargo test -- --nocapture`, `cargo test -p <crate>` in workspaces, `cargo test --doc` for doctests only. `cargo nextest run` if `nextest` is installed/configured.

### Expose configuration via features

- Declare `[features] default = ["std"]` / `serde = ["dep:serde"]`; gate code with `#[cfg(feature = "serde")]`. Features must be additive; never make a feature disable functionality.
- Test combinations in CI: `cargo build --no-default-features`, `cargo build --all-features`.

### Build a CLI with clap

```rust
#[derive(clap::Parser, Debug)]
#[command(version, about)]
struct Cli {
    #[arg(short, long, env = "APP_CONFIG")]
    config: std::path::PathBuf,
    #[command(subcommand)]
    cmd: Command,
}
```

Parse with `Cli::parse()` in `main`, then call `run(cli) -> anyhow::Result<()>`.

### Improve performance

1. Measure first: `cargo bench` (criterion or `divan`), `cargo flamegraph`, `--release` builds only.
2. Typical wins: avoid clones in loops (`iter()` over `into_iter()` then clone), pre-size `Vec::with_capacity`, `&str` slicing over `String` building, `HashMap` with `entry`, `SmallVec`/`Bytes` only when profiling says so.
3. Check `[profile.release]` (`lto`, `codegen-units`, `opt-level`) before micro-optimizing code.

## Pitfalls

- `.unwrap()` on `Option`/`Result` in production paths; use `?`, `ok_or_else`, `unwrap_or_default`, or `let Some(x) = ... else { return ... }`.
- Holding a `MutexGuard` or `RefCell` borrow across `.await` or across a call that re-locks (deadlock/panic).
- `String` concatenation with `+` in loops; use `format!`, `push_str`, or `write!` to a `String`.
- `as` casts silently truncate/wrap (`u64 as u32`); use `try_from`/`try_into` and handle the error.
- Indexing slices (`v[i]`) panics; prefer `get(i)` when the index is not provably valid.
- Returning `impl Trait` from a trait method before 1.75 or needing `dyn` compatibility (object safety): `async fn` in traits is not `dyn`-compatible; use `async_trait` crate or boxed futures for trait objects.
- Blocking calls (`std::thread::sleep`, `std::fs`, `reqwest::blocking`) inside async code starve the runtime.
- Forgetting `move` on closures passed to `thread::spawn`/`tokio::spawn`, or capturing a reference with insufficient lifetime.
- Default features pulling in heavy dependencies (`tokio` `full`, `reqwest` default TLS); specify what you need.
- Large enum variants (`clippy::large_enum_variant`); box the big payload.
- `#[derive(PartialEq)]` on floats is fine, but `Eq`/`Hash` are not implementable; do not use `f64` as a map key.
- Integer overflow panics in debug and wraps in release; use `checked_*`, `wrapping_*`, or `saturating_*` explicitly when it matters.
- Shadowing `Result` with a type alias without `E = ...` default, breaking `Result<T, OtherError>` usage in the same module.
- Editing `Cargo.lock` by hand; use `cargo update -p <crate>`.

## Verification

Discover commands in `Makefile`/`justfile`/`.cargo/config.toml` aliases/CI; typical loop:

```bash
cargo fmt --all -- --check          # format (fix: cargo fmt --all)
cargo clippy --all-targets --all-features -- -D warnings
cargo build --all-targets
cargo test --all-features           # or: cargo nextest run
cargo doc --no-deps                 # catches broken intra-doc links (add -D warnings via RUSTDOCFLAGS)
cargo deny check / cargo audit      # if configured (deny.toml) or installed
```

Use `cargo check` for a fast type-check loop. Clippy must pass at the configured level; do not add `#[allow(clippy::...)]` without a justification comment.

## References

- The Rust Book: https://doc.rust-lang.org/book/
- Rust API Guidelines: https://rust-lang.github.io/api-guidelines/
- std documentation: https://doc.rust-lang.org/std/
- Cargo book (workspaces, features, profiles): https://doc.rust-lang.org/cargo/
- Clippy lints: https://rust-lang.github.io/rust-clippy/master/
- Tokio tutorial: https://tokio.rs/tokio/tutorial
- thiserror: https://docs.rs/thiserror , anyhow: https://docs.rs/anyhow
- Rust Design Patterns: https://rust-unofficial.github.io/patterns/
