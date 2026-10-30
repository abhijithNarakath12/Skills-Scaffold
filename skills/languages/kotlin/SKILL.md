---
name: kotlin
description: Write, refactor and review Kotlin (1.9 and 2.x, K2 compiler) on the JVM and Android. Covers null safety, data/sealed/value classes, coroutines and Flow, extension and scope functions, Gradle Kotlin DSL with version catalogs, ktlint/detekt, and testing with JUnit 5, Kotest and MockK. Use when editing .kt/.kts files or a Gradle project applying org.jetbrains.kotlin plugins.
---

# Kotlin

Assumes Kotlin 1.9+ with 2.x (K2) preferred, on JVM 17+ or Android (AGP 8+). Check `kotlin("jvm")`/`kotlin("android")` plugin versions and `jvmToolchain` before using newer features (e.g. `data object` and `enum.entries` are stable from 1.9; K2-only behaviours start at 2.0).

## When to use

- Editing or creating `.kt` files, `.kts` build scripts, `gradle/libs.versions.toml`.
- Adding dependencies, structuring modules, writing coroutine or Flow code, configuring lint or tests.
- Reviewing Kotlin for nullability, coroutine scoping, mutability, or idiomatic API shape. For Java files in the same project, also load the `java` skill.

## Project conventions to detect first

Before writing code, check:

1. **Platform and versions**: `build.gradle.kts` plugins block (`kotlin("jvm")`, `kotlin("multiplatform")`, `com.android.application`, `kotlin("plugin.serialization")`, `com.google.devtools.ksp`), `kotlin { jvmToolchain(21) }`, `compileSdk`/`minSdk`, `kotlinOptions`/`compilerOptions` (`-Xjsr305=strict`, `allWarningsAsErrors`, `languageVersion`). Version catalog in `gradle/libs.versions.toml` is the single source of versions when present.
2. **Build layout**: `settings.gradle.kts` `include(...)` modules, `buildSrc/` or `build-logic/` convention plugins, `gradle.properties` (`kotlin.code.style=official`, `org.gradle.configuration-cache`). Use `./gradlew`.
3. **Framework**: Spring Boot (`kotlin("plugin.spring")`), Ktor, Android (Jetpack Compose, Hilt, Room), Exposed/jOOQ, kotlinx.serialization vs Jackson/Moshi.
4. **Lint/format**: ktlint (`org.jlleitschuh.gradle.ktlint` or `com.pinterest.ktlint` via Spotless, `.editorconfig` with `ktlint_*` rules), detekt (`detekt.yml`, baseline file), Android Lint. Run the configured tool.
5. **Testing**: JUnit 5 (`kotlin("test")` + `useJUnitPlatform()`), Kotest (`io.kotest`), MockK vs Mockito-Kotlin, Turbine for Flow, `kotlinx-coroutines-test`, Robolectric/Compose UI tests on Android.
6. **Existing style**: DI approach (constructor injection, Koin, Hilt), error modelling (`Result`, sealed classes, exceptions), coroutine dispatcher injection, `internal` usage across modules, package naming.

## Core guidance

### Null safety and types

- Never use `!!` in production code. Prefer `?.`, `?:`, `requireNotNull(x) { "message" }`, `checkNotNull`, or restructure so the type is non-null.
- Make types non-null by default; model absence with `?` only at true boundaries (parsing, DB, platform calls). Treat Java interop types as platform types carefully: declare the Kotlin type explicitly (`val name: String = javaObj.name`) so a null fails at the boundary.
- `lateinit` only for framework-injected fields; `by lazy` for expensive read-only initialisation.
- Use `val` by default; `var` only when reassigned. Expose read-only collections (`List`, `Map`) and keep `MutableList` private.
- `data class` for value carriers; `@JvmInline value class` for typed ids/units; `sealed interface`/`sealed class` for closed hierarchies with exhaustive `when`:

```kotlin
sealed interface LoadState<out T> {
    data object Loading : LoadState<Nothing>
    data class Success<T>(val data: T) : LoadState<T>
    data class Failure(val error: Throwable) : LoadState<Nothing>
}

fun <T> LoadState<T>.describe(): String = when (this) {
    LoadState.Loading -> "loading"
    is LoadState.Success -> "got ${data}"
    is LoadState.Failure -> "failed: ${error.message}"
}
```

- `enum class` with `entries` (1.9+) instead of `values()`.
- Prefer expression bodies for one-liners, named arguments for booleans and multiple same-typed params, default parameters over overloads, trailing lambdas.

### Functions, scope functions, extensions

- Extension functions for adding behaviour to types you do not own; keep them in a file named after the receiver (`StringExt.kt`) or next to the feature. Do not use extensions to hide domain logic that belongs in a class.
- Scope functions: `let` for null-safe transforms, `apply` for configuring an object, `also` for side effects, `run`/`with` for grouped calls. Do not nest more than one; do not use them where a plain statement is clearer.
- Top-level functions over `object` utility holders; `companion object` only for factories and constants that must be tied to the class.
- Use `Result<T>`/`runCatching` only at boundaries you own; do not catch `CancellationException` (rethrow it) inside coroutines.

### Coroutines

- Structured concurrency: launch inside a `CoroutineScope` tied to a lifecycle (`viewModelScope`, `lifecycleScope`, Ktor `call` scope, Spring request scope, or an application scope with `SupervisorJob()` that is cancelled on shutdown). Never use `GlobalScope`.
- `suspend` functions do not launch; they call other suspend functions and return. Use `coroutineScope { }` for parallel decomposition inside a suspend function, `supervisorScope` when siblings may fail independently.
- Inject dispatchers (`class Repo(private val io: CoroutineDispatcher = Dispatchers.IO)`) so tests can pass `StandardTestDispatcher`. Switch with `withContext(io)` at the lowest layer that blocks; a suspend function should be main-safe.
- Cancellation: check `ensureActive()`/`yield()` in CPU loops; use `withTimeout`/`withTimeoutOrNull`; `NonCancellable` only for cleanup that must finish. Never swallow `CancellationException`.
- Concurrency primitives: `Mutex` (not `synchronized`) around suspend points, `Channel` for producer/consumer, `async`/`await` for parallel results (`awaitAll`).

```kotlin
suspend fun loadDashboard(): Dashboard = coroutineScope {
    val user = async { userRepo.current() }
    val stats = async { statsRepo.fetch() }
    Dashboard(user.await(), stats.await())
}
```

### Flow

- Cold `Flow` for streams; `StateFlow` for observable state (always has a value), `SharedFlow` for events (configure `replay`/`extraBufferCapacity`). Convert with `stateIn(scope, SharingStarted.WhileSubscribed(5_000), initial)`.
- Operators: `map`, `filter`, `combine`, `flatMapLatest`, `distinctUntilChanged`, `debounce`; run upstream on another dispatcher with `flowOn`, never `withContext` inside a `flow { }` builder.
- Collect in a lifecycle-aware way (`repeatOnLifecycle(STARTED)` on Android, `collectAsStateWithLifecycle()` in Compose). Handle errors with `catch` (upstream only) and completion with `onCompletion`.
- Flows should not throw from the collector; emit failures as sealed states.

### Interop with Java

- Annotate for Java callers when the API is shared: `@JvmStatic`, `@JvmOverloads`, `@JvmField`, `@file:JvmName("Strings")`, `@Throws(IOException::class)`.
- Expose suspend functions to Java via the `future { }` builder (`kotlinx.coroutines.future`, in coroutines-core since 1.7) or blocking wrappers at the boundary only.
- Enable `-Xjsr305=strict` and add JSpecify/`@Nullable` annotations on Java APIs to get real null checks.

### Android specifics

- UI state in a `ViewModel` as `StateFlow<UiState>`; one-shot events via `Channel`/`SharedFlow`; immutable `data class` state copied with `copy()`.
- Compose: stateless composables with state hoisting, `remember`/`rememberSaveable`, stable parameter types (immutable collections or `@Immutable`), `LaunchedEffect(key)` for side effects, `derivedStateOf` for computed state.
- Use `viewModelScope` and `Dispatchers.Main.immediate` defaults; move DB/network to `Dispatchers.IO` inside repositories.
- Prefer kotlinx.serialization, Room with suspend DAOs/Flow, Hilt for DI, and the Gradle version catalog with `alias(libs.plugins.android.application)`.

## Common tasks

### Add a dependency (version catalog)

1. In `gradle/libs.versions.toml`: add under `[versions]` and `[libraries]`, e.g. `kotlinx-coroutines-core = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-core", version.ref = "coroutines" }`.
2. In the module `build.gradle.kts`: `implementation(libs.kotlinx.coroutines.core)`; `testImplementation` for tests; `api` only in library modules that expose the type.
3. Run `./gradlew :module:dependencies --configuration runtimeClasspath` to confirm resolution. Without a catalog, use string coordinates `implementation("group:artifact:version")`.

### Add a module (Gradle KTS)

1. `include(":feature:payments")` in `settings.gradle.kts`; create `feature/payments/build.gradle.kts` applying the convention plugin or `kotlin("jvm")` and `jvmToolchain`.
2. Mark module-private API `internal`; expose a small public surface.
3. Add `src/test/kotlin` with the same test stack as sibling modules.

### Write tests

JUnit 5 + MockK + coroutines-test:

```kotlin
class PaymentServiceTest {
    private val gateway = mockk<Gateway>()
    private val service = PaymentService(gateway, Dispatchers.Unconfined)

    @Test
    fun `charges the card once`() = runTest {
        coEvery { gateway.charge(any()) } returns Receipt("r1")
        val receipt = service.pay(Money(10, "USD"))
        assertEquals("r1", receipt.id)
        coVerify(exactly = 1) { gateway.charge(any()) }
    }
}
```

- Use `runTest` for suspend code; inject `StandardTestDispatcher(testScheduler)` and `advanceUntilIdle()` for timing; `Turbine` (`flow.test { awaitItem() }`) for Flow.
- Kotest: `StringSpec`/`FunSpec` styles, `shouldBe` matchers, property tests with `checkAll`; configure `useJUnitPlatform()` and the Kotest Gradle plugin or JUnit runner as the repo does.
- Prefer fakes over MockK for repositories; use `mockk(relaxed = true)` sparingly.

### Configure ktlint and detekt

```kotlin
plugins {
    id("org.jlleitschuh.gradle.ktlint") version "12.1.1"
    id("io.gitlab.arturbosch.detekt") version "1.23.6"
}
detekt { config.setFrom(files("$rootDir/detekt.yml")); buildUponDefaultConfig = true }
```

Check the latest plugin versions on plugins.gradle.org before adding. Run `./gradlew ktlintFormat` / `ktlintCheck` and `./gradlew detekt`. With Spotless instead: `spotless { kotlin { ktlint() } }`.

### Convert Java to Kotlin

1. Convert one file at a time (IDE converter), then clean: remove `!!`, replace getters/setters with properties, Java beans with `data class`, static utils with top-level functions, `Optional` with nullable types, builders with named/default arguments.
2. Replace `synchronized`/`ExecutorService` with coroutines where the surrounding code is already suspend-based; otherwise keep Java concurrency until the boundary is clear.
3. Keep Java callers working with `@Jvm*` annotations; run the full test suite.

### Upgrade to Kotlin 2.x (K2)

1. Bump the `kotlin` version in the catalog and any compiler plugins (`ksp`, `compose-compiler` now ships with Kotlin: apply `org.jetbrains.kotlin.plugin.compose`).
2. Build with warnings as errors off first; fix new resolution/smart-cast errors; remove obsolete `-Xopt-in`/`languageVersion` flags.
3. Verify detekt/ktlint versions support the new Kotlin version (check their release notes).

## Pitfalls

- `!!`, `lateinit` read before init, `as` casts instead of `as?` with handling.
- `GlobalScope.launch`, `runBlocking` inside suspend code or on the main thread, launching from a suspend function instead of using `coroutineScope`.
- Catching `Exception`/`Throwable` in coroutines and swallowing `CancellationException`; always rethrow it or use `runCatching` variants that exclude it.
- `Dispatchers.IO`/`Main` hardcoded deep in classes; inject dispatchers for testability.
- Exposing `MutableStateFlow`/`MutableList` publicly; expose `asStateFlow()`/read-only types.
- `withContext` inside `flow { }`; use `flowOn`. Collecting Flow in `init` of a ViewModel without lifecycle handling.
- Data classes with mutable `var` properties or arrays (array `equals` is by reference); use `List`.
- Overusing scope functions (`?.let { } ?: run { }` for simple if/else), long `apply` chains hiding mutation.
- `companion object` constants without `const val`; utility `object`s where top-level functions suffice.
- Unnecessary `open`/inheritance; prefer composition and `sealed` types. Remember Spring needs `kotlin("plugin.spring")` to open beans.
- Default `equals` on `value class` wrappers of arrays/floats; `Double` comparisons with `==`.
- Platform-type leaks from Java (`String!`) assigned to inferred `val`; annotate explicit types at boundaries.
- Gradle: mixing Groovy and KTS scripts, hardcoding versions outside the catalog, forgetting `jvmToolchain`, ignoring configuration-cache warnings.

## Verification

Discover tasks with `./gradlew tasks --all` and the CI workflow. Typical loop:

```bash
./gradlew ktlintFormat          # or: spotlessApply
./gradlew ktlintCheck detekt    # whichever is configured
./gradlew compileKotlin compileTestKotlin
./gradlew test                  # --tests 'com.acme.PaymentServiceTest' for one class
./gradlew check                 # lint + tests + verification tasks
./gradlew build                 # Android: ./gradlew :app:assembleDebug lint
```

Treat compiler warnings as errors when `allWarningsAsErrors` is set; fix detekt findings rather than adding to the baseline unless the project policy says otherwise.

## References

- Kotlin docs: https://kotlinlang.org/docs/home.html
- Kotlin coding conventions: https://kotlinlang.org/docs/coding-conventions.html
- Coroutines guide: https://kotlinlang.org/docs/coroutines-guide.html
- Flow: https://kotlinlang.org/docs/flow.html
- kotlinx-coroutines-test: https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-test/
- Gradle Kotlin DSL primer: https://docs.gradle.org/current/userguide/kotlin_dsl.html
- Version catalogs: https://docs.gradle.org/current/userguide/version_catalogs.html
- ktlint: https://pinterest.github.io/ktlint/ , detekt: https://detekt.dev/docs/intro
- Kotest: https://kotest.io/docs/framework/framework.html , MockK: https://mockk.io/
- Android Kotlin style guide: https://developer.android.com/kotlin/style-guide
