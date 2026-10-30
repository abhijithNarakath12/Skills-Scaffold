---
name: scala
description: Write, refactor and review Scala 3 code in sbt projects (services, libraries, data jobs). Covers sbt build structure, immutability and case classes, Scala 3 enums, for-comprehensions, Option/Either/Try error handling, given/using contextual abstractions (replacing implicits), ScalaTest/MUnit testing and scalafmt. Use when editing .scala or .sc files or a project with build.sbt.
---

# Scala

Assumes Scala 3.3+ LTS and sbt 1.9+. Scala 2.13 code is common in existing repos; check `scalaVersion` in `build.sbt` before using Scala 3 syntax (`enum`, `given`/`using`, `extension`, indentation-based blocks, `*` varargs splat). Keep to the syntax style already in the codebase (braces vs significant indentation).

## When to use

- Editing or creating `.scala`, `.sc` (scala-cli/Ammonite scripts), `build.sbt`, `project/*.sbt`, `project/*.scala`, `.scalafmt.conf`.
- Adding library dependencies, modules, tests, compiler flags or sbt plugins.
- Reviewing Scala for immutability, effect handling, type safety or implicit resolution.

## Project conventions to detect first

1. `build.sbt`: `scalaVersion`, `ThisBuild / scalaVersion`, multi-module layout (`lazy val core = project.in(file("core"))`), `scalacOptions` (`-Werror`, `-Wunused:all`, `-source:future`, `-Xfatal-warnings` in 2.13), `libraryDependencies` (`%%` for Scala-versioned artifacts, `%%%` for Scala.js).
2. `project/build.properties` (`sbt.version`), `project/plugins.sbt` (`sbt-scalafmt`, `sbt-tpolecat`, `sbt-scoverage`, `sbt-native-packager`, `sbt-assembly`, `sbt-revolver`).
3. Effect/ecosystem flavour: Typelevel (`cats-effect`, `fs2`, `http4s`, `doobie`, `circe`), ZIO (`zio`, `zio-http`, `zio-json`), Akka/Pekko, Play, Spark (`org.apache.spark`), or plain `Future`s. Match the stack; do not mix effect systems in one module.
4. Test framework: `scalatest` (`AnyFunSuite`, `AnyFlatSpec`, `AnyWordSpec`), `munit` (+ `munit-cats-effect`, `munit-zio`), `specs2`, `scalacheck`/`munit-scalacheck`, `zio-test`.
5. Formatting: `.scalafmt.conf` with `runner.dialect = scala3`, `version`. `.scalafix.conf` for rewrite rules (`OrganizeImports`, `RemoveUnused`).
6. Build alternatives: `build.sc`/`build.mill` (Mill), `//> using` directives (scala-cli), Gradle/Maven for Spark jobs. Use the one present.
7. Layout: `src/main/scala`, `src/test/scala`, `src/main/resources`, `src/it/scala` (integration tests, or `IntegrationTest` config replaced by a separate module in modern sbt).

## Core guidance

### Immutability and data modelling

- `val` always; `var` only inside a tightly scoped algorithm. Immutable collections (`List`, `Vector`, `Map`, `Set`) by default; `scala.collection.mutable` only locally and never escaping a method.
- `case class` for data (structural equality, `copy`, pattern matching); `final case class` in Scala 2; Scala 3 case classes cannot be extended anyway unless declared `open`.
- Scala 3 `enum` for ADTs, replacing `sealed trait` + `case object`/`case class`:

```scala
enum PaymentStatus:
  case Pending
  case Settled(at: java.time.Instant)
  case Failed(reason: String)

def describe(s: PaymentStatus): String = s match
  case PaymentStatus.Pending       => "waiting"
  case PaymentStatus.Settled(at)   => s"settled at $at"
  case PaymentStatus.Failed(reason) => s"failed: $reason"
```

- Exhaustive matching on `sealed`/`enum` types; let `-Werror` catch missing cases. Avoid `case _ =>` catch-alls over sealed hierarchies.
- `opaque type UserId = String` (Scala 3) for zero-cost newtypes; companion `apply`/`unwrap`. Scala 2: `AnyVal` wrappers or `newtype` libraries.
- Avoid `null`; wrap Java APIs with `Option(javaCall())`.

### Option / Either / Try

- `Option` for absence; `Either[Error, A]` for expected failures with typed errors (right-biased, `map`/`flatMap`/`fold`); `Try` only at the boundary with throwing Java code (`Try(parse(s)).toEither`).
- Never `.get` on `Option`/`Either`/`Try`; use `getOrElse`, `fold`, pattern matching, or `.toRight(error)`.
- Model domain errors as a `sealed trait`/`enum` and return `Either[AppError, A]` or `IO[A]` with typed errors (`ZIO[R, E, A]`).
- Compose in for-comprehensions; keep each line one effect:

```scala
def register(req: Request): Either[AppError, User] =
  for
    email <- Email.parse(req.email)
    name  <- NonEmpty.parse(req.name)
    user  <- repo.insert(User(email, name))
  yield user
```

- For-comprehensions require the same monad throughout; convert (`Option#toRight`, `IO.fromEither`) before mixing.

### Contextual abstractions (Scala 3)

- `given` instances replace `implicit val/def`; `using` clauses replace implicit parameters; `summon[T]` replaces `implicitly[T]`:

```scala
trait Show[A]:
  def show(a: A): String

given Show[Int] with
  def show(a: Int) = a.toString

given [A](using s: Show[A]): Show[List[A]] with
  def show(as: List[A]) = as.map(s.show).mkString("[", ", ", "]")

extension [A](a: A)(using s: Show[A]) def show: String = s.show(a)
```

- `extension` methods replace implicit classes. Import givens explicitly: `import mylib.given` (wildcard `*` does not import givens).
- Place givens in the type class or type companion object so they resolve without imports. Avoid implicit conversions (`Conversion[A, B]`) except for well-known DSLs; they need `import scala.language.implicitConversions`.
- In Scala 2.13 code keep `implicit` syntax; do not half-migrate a module.

### Functions and style

- Small, pure functions; side effects at the edges or inside the effect type (`IO`/`ZIO`/`Future`).
- Prefer `map`/`flatMap`/`foldLeft`/`collect`/`groupMap` over loops and `var` accumulators. `view` or `LazyList`/`Iterator` for large pipelines; `fs2.Stream`/`ZStream` in effect systems.
- Explicit return types on public members (library binary compatibility, faster compilation). Infer locals.
- Scala 3 syntax: optional braces with `:` and significant indentation, `then`/`do` in `if`/`while`, `end X` markers for long blocks, top-level definitions (no package objects), `@main` methods for entry points, union types `A | B`, `inline`.
- Naming: `lowerCamelCase` vals/defs, `UpperCamelCase` types/objects, packages all lowercase. Use `scalafmt`; never hand-align.
- String interpolation `s"..."`, `f"$x%.2f"`, and triple-quoted `"""..."""` with `.stripMargin`.

### Concurrency and effects

- `Future` needs an `ExecutionContext`; pass it `(using ec: ExecutionContext)` and never use `global` in library code. `Future`s are eager; wrap side effects in `Future { }` not `Future.successful`.
- cats-effect: `IO` is lazy; sequence with for-comprehensions; `Resource` for acquire/release; `IOApp.Simple`; `parTraverse`, `Ref`, `Deferred`, `Supervisor` for concurrency.
- ZIO: `ZIO[R, E, A]`, `ZLayer` for dependencies, `ZIOAppDefault`, `Scope` for resources.
- Never `Await.result` outside tests/main; never block inside `IO` without `IO.blocking`.

## Common tasks

### Add a module or dependency

```scala
// build.sbt
ThisBuild / scalaVersion := "3.3.4"
ThisBuild / scalacOptions ++= Seq("-deprecation", "-feature", "-Wunused:all", "-Werror")

lazy val core = project.in(file("core"))
  .settings(
    libraryDependencies ++= Seq(
      "org.typelevel" %% "cats-core" % "2.12.0",
      "org.scalameta" %% "munit"     % "1.0.2" % Test,
    )
  )

lazy val api = project.in(file("api")).dependsOn(core)
```

Then `sbt reload` (or `reload` inside the sbt shell). Find current versions on https://index.scala-lang.org/ or with `sbt dependencyUpdates` (sbt-updates plugin). `% Test` scopes test-only deps; `% "compile->compile;test->test"` shares test code between modules.

### Write tests

```scala
// MUnit
class ParserSuite extends munit.FunSuite:
  test("parses key=value") {
    assertEquals(Parser.parse("a=1"), Right(Map("a" -> "1")))
  }
  test("rejects malformed input") {
    assert(Parser.parse("==").isLeft)
  }

// ScalaTest
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

class ParserSpec extends AnyFunSuite with Matchers:
  test("parses key=value") {
    Parser.parse("a=1") shouldBe Right(Map("a" -> "1"))
  }
```

Property tests: `munit-scalacheck` `property("...") { forAll { (n: Int) => ... } }`. Effectful tests: `munit.CatsEffectSuite` (`test("io") { IO(1).assertEquals(1) }`) or `zio.test.ZIOSpecDefault`. Run one suite: `sbt "testOnly *ParserSuite"`; one test: `sbt "testOnly *ParserSuite -- *parses*"` (ScalaTest `-z`, MUnit `--tests=` differ; check the framework docs).

### Add an application entry point

```scala
@main def run(args: String*): Unit = ...
// or cats-effect
object Main extends IOApp.Simple:
  def run: IO[Unit] = ...
```

Set `Compile / mainClass := Some("com.acme.Main")` in `build.sbt` for packaging; `sbt run`, `sbt "runMain com.acme.Main"`.

### Migrate Scala 2 to Scala 3

1. Upgrade to 2.13 latest first; enable `-Xsource:3` and fix warnings.
2. Switch `scalaVersion` to `3.3.x`; replace Scala-2-only macros/plugins (`kind-projector` → `-Ykind-projector`, `better-monadic-for` built in).
3. Use `scalafix` rules to rewrite `implicit` → `given`/`using` gradually; keep braces until the team opts into indentation syntax.
4. Cross-build if needed: `crossScalaVersions := Seq("2.13.14", "3.3.4")` and `src/main/scala-2`/`scala-3` directories for divergent code.

## Pitfalls

- `Seq` in Scala 2.13+ is `scala.collection.immutable.Seq`, but Java interop may hand you mutable buffers; convert with `.toList`/`.toVector`.
- `==` on arrays compares references; use `sameElements` or `.toList`.
- `Future` created outside the for-comprehension runs eagerly; order `val`s deliberately when you want parallelism.
- Forgetting `given` imports (`import cats.syntax.all.*`, `import io.circe.generic.auto.*`), producing "No given instance" errors; check which import the codebase uses.
- Recursive functions without `@tailrec` blow the stack; annotate and let the compiler verify.
- Overusing `Any`/`asInstanceOf`; let a pattern match or type class carry the information.
- `scalacOptions` with `-Werror` plus unused imports after refactors fail the build; run `scalafix RemoveUnused` or fix imports.
- Mixing Scala 3 indentation syntax and braces inconsistently; follow `.scalafmt.conf` (`rewrite.scala3.*` settings).
- Slow compiles from very large files or deeply implicit-heavy code; split modules, use `sbt --client` / Bloop, keep an sbt shell open.
- Editing `target/` or `project/target/`; build output only.

## Verification

```bash
sbt compile Test/compile          # or inside sbt shell: ~compile for watch mode
sbt test                          # all modules
sbt "core/testOnly *ParserSuite"  # single module/suite
sbt scalafmtCheckAll scalafmtSbtCheck   # formatting (sbt-scalafmt); fix with scalafmtAll
sbt "scalafixAll --check"         # if sbt-scalafix is configured
sbt coverage test coverageReport  # if sbt-scoverage is configured
```

Prefer a single long-running `sbt` shell or `sbt --client` to avoid JVM startup per command. Check `.github/workflows/*.yml` or the `Makefile` for the exact CI invocation and JDK version (`.tool-versions`, `.sdkmanrc`, `.java-version`).

## References

- Scala 3 book: https://docs.scala-lang.org/scala3/book/introduction.html
- Scala 3 reference (contextual abstractions): https://docs.scala-lang.org/scala3/reference/contextual/
- Scala 2 to 3 migration guide: https://docs.scala-lang.org/scala3/guides/migration/compatibility-intro.html
- sbt reference: https://www.scala-sbt.org/1.x/docs/
- Scala style guide: https://docs.scala-lang.org/style/
- scalafmt configuration: https://scalameta.org/scalafmt/docs/configuration.html
- MUnit: https://scalameta.org/munit/docs/getting-started.html
- ScalaTest user guide: https://www.scalatest.org/user_guide
