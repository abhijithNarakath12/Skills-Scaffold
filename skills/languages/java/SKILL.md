---
name: java
description: Write, refactor and review Java (17 LTS and 21 LTS) applications and libraries built with Maven or Gradle. Covers records, sealed types, pattern matching for switch, Optional, streams, exception design, immutability, JUnit 5 with Mockito and AssertJ, and formatting/lint with Spotless, Checkstyle and Error Prone. Use when editing .java files or a project with pom.xml, build.gradle or build.gradle.kts.
---

# Java

Assumes Java 17 as the minimum and prefers Java 21 idioms (pattern matching for `switch`, record patterns, sequenced collections, virtual threads). Check the configured release level before using 21-only features.

## When to use

- Editing or creating `.java` files, `module-info.java`, `pom.xml`, `build.gradle(.kts)`, `settings.gradle(.kts)`.
- Adding dependencies, restructuring packages, writing tests, configuring formatting or static analysis.
- Reviewing Java for null safety, immutability, exception handling, stream misuse or test quality.

## Project conventions to detect first

Before writing code, check:

1. **Java version**: Maven `<maven.compiler.release>` (or `<source>/<target>`), Gradle `java { toolchain { languageVersion = JavaLanguageVersion.of(21) } }` or `sourceCompatibility`, `.sdkmanrc`, `.java-version`, CI matrix. Never use syntax above the release level (`switch` patterns and record patterns are final in 21; `sealed` and records in 17).
2. **Build tool**: `pom.xml` (Maven; check for `mvnw`), `build.gradle.kts`/`build.gradle` (Gradle; use `./gradlew`). Multi-module layout: Maven `<modules>`, Gradle `settings.gradle(.kts)` `include(...)`. Use the wrapper if present.
3. **Framework**: Spring Boot (`spring-boot-starter-*`), Quarkus, Micronaut, Jakarta EE, plain. Framework conventions (DI, config, testing slices) override general advice.
4. **Formatting/lint**: Spotless (`spotless` plugin with `googleJavaFormat()` / `palantirJavaFormat()` / `eclipse()`), Checkstyle (`checkstyle.xml`), PMD, SpotBugs, Error Prone, `.editorconfig`. Run the formatter rather than hand-formatting.
5. **Testing stack**: JUnit 5 (`org.junit.jupiter`) vs JUnit 4, Mockito, AssertJ vs Hamcrest, Testcontainers, ArchUnit. Test location `src/test/java` mirroring main packages.
6. **Null-safety and immutability conventions**: JSpecify/`@Nullable` annotations, Lombok (`@Value`, `@Builder`), Immutables, records usage, `Optional` return conventions.
7. **Logging**: SLF4J facade with Logback/Log4j2; `System.out` is never acceptable in main code.

## Core guidance

### Modern language features (17/21)

- `record` for immutable data carriers (DTOs, value objects, map keys). Add compact constructors for validation:

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount);
        Objects.requireNonNull(currency);
        if (amount.scale() > currency.getDefaultFractionDigits()) {
            throw new IllegalArgumentException("scale too large: " + amount);
        }
    }
}
```

- `sealed interface` + records for closed hierarchies; exhaustive `switch` without `default` so the compiler flags new variants:

```java
sealed interface Shape permits Circle, Square {}
record Circle(double r) implements Shape {}
record Square(double side) implements Shape {}

static double area(Shape s) {
    return switch (s) {
        case Circle c -> Math.PI * c.r() * c.r();
        case Square(double side) -> side * side;   // record pattern, Java 21
    };
}
```

- Pattern matching `instanceof`: `if (obj instanceof String s && !s.isBlank())`.
- `var` for local variables when the type is obvious from the right-hand side; never for fields or when it hides the type (`var x = service.get()`).
- Text blocks (`"""`) for multi-line strings (SQL, JSON fixtures). `String.formatted(...)` over `String.format` for readability.
- `enum` with behaviour for fixed sets; `EnumMap`/`EnumSet` for enum-keyed collections.
- Java 21: `SequencedCollection` (`getFirst()`, `reversed()`), virtual threads via `Executors.newVirtualThreadPerTaskExecutor()` for I/O-bound concurrency, `String templates` are not final (do not use).

### Null handling and Optional

- Never return `null` for collections; return `List.of()`/`Collections.emptyList()`.
- `Optional` as a return type for "may be absent", never as a field, parameter, or collection element. Do not call `.get()`; use `orElseThrow()`, `orElse`, `map`, `ifPresentOrElse`.
- Validate arguments at public boundaries with `Objects.requireNonNull(x, "x")` or framework validation; annotate with `@Nullable` (JSpecify or the project's choice) where null is allowed.

### Immutability and collections

- Prefer unmodifiable collections: `List.of`, `Map.of`, `Set.of`, `List.copyOf`, `Collectors.toUnmodifiableList()` or `.toList()` (Java 16+, unmodifiable). Defensive-copy mutable inputs in constructors.
- Favour `final` fields, constructor injection, no setters. Records or builders for construction.
- Program to interfaces (`List`, `Map`) in signatures; choose implementations (`ArrayList`, `HashMap`, `LinkedHashMap` for ordered) at creation.

### Streams and lambdas

- Use streams for transformations (`map`/`filter`/`collect`); use loops when there is mutation, early exit with side effects, or checked exceptions.
- Keep lambdas pure and short; extract method references (`User::name`). Avoid side effects in `map`/`peek`.
- Use `Collectors.groupingBy`, `toMap` (always supply a merge function), `joining`. Avoid `.parallel()` unless measured.

### Exceptions

- Unchecked (`RuntimeException` subclasses) for programming errors and most application failures; checked only when the caller is realistically expected to recover and the API is a library boundary.
- Define a small domain hierarchy (`DomainException` → `NotFoundException`, `ValidationException`). Include ids/context in the message; never swallow (`catch (Exception e) {}`) or log-and-rethrow at every layer.
- Wrap with cause: `throw new ConfigException("loading " + path, e)`. Never lose the original exception.
- `try-with-resources` for every `AutoCloseable`; multi-catch (`catch (IOException | UncheckedIOException e)`) to avoid duplication.
- Do not use exceptions for control flow.

### Concurrency

- Prefer high-level constructs: `ExecutorService` (virtual threads on 21), `CompletableFuture`, `java.util.concurrent` collections and atomics, over raw `Thread`/`synchronized`/`wait`/`notify`.
- Make shared objects immutable; if mutable, confine to one thread or guard with one lock consistently. Document thread-safety in Javadoc.
- Always set timeouts on blocking calls (`future.get(5, SECONDS)`, HTTP clients, `awaitTermination`).

### API and package design

- Package by feature (`com.acme.billing.invoice`) rather than by layer when starting new modules; follow existing structure otherwise.
- Minimise visibility: package-private by default, `public` for API, `private` for implementation. Avoid utility classes with static state.
- Javadoc on public types and methods: what, contracts (null, thread-safety), `@throws`.
- Implement `equals`/`hashCode`/`toString` consistently (records give them for free); never mutate fields used in `hashCode`.

## Common tasks

### Add a dependency

- Maven: add `<dependency>` to `pom.xml` under `<dependencies>`; manage versions in `<dependencyManagement>` or a BOM (`spring-boot-dependencies`). Run `./mvnw -q dependency:tree` to check conflicts.
- Gradle Kotlin DSL: `implementation("com.fasterxml.jackson.core:jackson-databind:2.17.2")` or via version catalog `implementation(libs.jackson.databind)` (`gradle/libs.versions.toml`). Use `testImplementation` for test-only, `api` only in library modules that expose the type. Check with `./gradlew dependencies --configuration runtimeClasspath`.

### Add a class or feature

1. Place it in the feature package; model data with records, behaviour in a small service class with constructor injection.
2. Write the test first in `src/test/java/<same package>/<Class>Test.java`.
3. Run format, compile, tests for the affected module only (`./mvnw -pl module -am test`, `./gradlew :module:test`).

### Write tests (JUnit 5 + AssertJ + Mockito)

```java
@ExtendWith(MockitoExtension.class)
class InvoiceServiceTest {
    @Mock InvoiceRepository repo;
    @InjectMocks InvoiceService service;

    @Test
    void totalsLineItems() {
        when(repo.find("inv-1")).thenReturn(Optional.of(invoiceWith(2, 3)));
        assertThat(service.total("inv-1")).isEqualByComparingTo("5.00");
        verify(repo).find("inv-1");
    }

    @ParameterizedTest
    @CsvSource({"0,0", "1,1", "2,4"})
    void squares(int in, int expected) { assertThat(Math.pow(in, 2)).isEqualTo(expected); }
}
```

- `@Nested` classes for grouping, `@DisplayName` sparingly, `@TempDir` for files, `assertThatThrownBy(() -> ...).isInstanceOf(X.class).hasMessageContaining("...")`.
- Mock only collaborators you own at the boundary; do not mock value objects, records, or the class under test.
- Integration tests: Testcontainers for databases/brokers; Spring `@SpringBootTest`/`@WebMvcTest`/`@DataJpaTest` slices; keep them in a separate source set or tag (`@Tag("integration")`) if the build distinguishes.

### Configure formatting (Spotless)

Gradle Kotlin DSL:

```kotlin
plugins { id("com.diffplug.spotless") version "6.25.0" }
spotless { java { googleJavaFormat(); removeUnusedImports(); target("src/**/*.java") } }
```

Maven: `com.diffplug.spotless:spotless-maven-plugin` with `<googleJavaFormat/>`. Apply with `./gradlew spotlessApply` / `./mvnw spotless:apply`; check with `spotlessCheck` / `spotless:check`. Verify the plugin version against the plugin portal before adding.

### Migrate Java 11/17 code to 21 idioms

1. Replace boilerplate POJOs with records where the class is a pure data carrier (watch for frameworks requiring no-arg constructors, e.g. JPA entities stay classes).
2. Convert `if/else instanceof` chains to pattern `switch` with sealed hierarchies.
3. Replace `Collectors.toList()` with `.toList()`, `list.get(0)` with `getFirst()`.
4. For I/O-bound thread pools, switch to virtual threads; remove pool sizing that only existed to limit platform threads. Avoid `synchronized` blocks around I/O (pins virtual threads before Java 24); use `ReentrantLock`.

## Pitfalls

- `Optional.get()` without `isPresent`, `Optional` fields/parameters, `Optional.of(null)`.
- Returning or exposing mutable internals (`getItems()` returning the internal `ArrayList`); return `List.copyOf` or an unmodifiable view.
- `==` on `String`, boxed `Integer` (outside -128..127), or `BigDecimal` (`equals` considers scale; use `compareTo`).
- Catching `Exception`/`Throwable` broadly, swallowing `InterruptedException` (restore with `Thread.currentThread().interrupt()`).
- Mutable `static` state and singletons; service classes with setters.
- `new Date()`, `SimpleDateFormat`, `Calendar`: use `java.time` (`Instant`, `LocalDate`, `ZonedDateTime`, `DateTimeFormatter`).
- Floating point for money; use `BigDecimal` with explicit scale and `RoundingMode`.
- Checked exceptions inside lambdas; wrap in a small helper or use loops.
- Streams that mutate external state, re-use a consumed stream, or use `peek` for logic.
- Over-mocking: `when(...).thenReturn(...)` chains that mirror implementation; tests that break on refactor without behaviour change.
- Missing `@Override`, `equals` without `hashCode`, `hashCode` on mutable fields.
- Lombok `@Data` on entities/value types (generates mutable setters and risky `equals`); prefer records or `@Value`.
- Field injection (`@Autowired` on fields); use constructor injection.
- Ignoring compiler warnings (`-Xlint:all`) and raw types (`List` instead of `List<String>`).

## Verification

Discover commands from the build file and CI; use the wrapper. Typical loop:

```bash
# Maven
./mvnw -q spotless:apply            # or: spotless:check
./mvnw -q -DskipTests compile
./mvnw -q test                      # add -Dtest=ClassName#method for one test
./mvnw -q verify                    # runs checkstyle/pmd/spotbugs/integration tests if bound

# Gradle
./gradlew spotlessApply             # or: spotlessCheck
./gradlew compileJava compileTestJava
./gradlew test --tests 'com.acme.InvoiceServiceTest'
./gradlew check                     # test + checkstyle + other verification tasks
./gradlew build
```

Compile with zero warnings where the build enables `-Werror`. Fix Checkstyle/PMD/Error Prone findings instead of suppressing them; a `@SuppressWarnings` needs a comment.

## References

- Java 21 language updates: https://docs.oracle.com/en/java/javase/21/language/
- JDK 21 API docs: https://docs.oracle.com/en/java/javase/21/docs/api/
- Google Java Style Guide: https://google.github.io/styleguide/javaguide.html
- JUnit 5 user guide: https://junit.org/junit5/docs/current/user-guide/
- AssertJ: https://assertj.github.io/doc/ , Mockito: https://javadoc.io/doc/org.mockito/mockito-core/latest/
- Spotless: https://github.com/diffplug/spotless , Checkstyle: https://checkstyle.org/
- Maven: https://maven.apache.org/guides/ , Gradle Java plugin: https://docs.gradle.org/current/userguide/java_plugin.html
- Error Prone bug patterns: https://errorprone.info/bugpatterns
