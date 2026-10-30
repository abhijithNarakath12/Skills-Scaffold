---
name: dart
description: Write, refactor and review Dart 3 code in packages, CLIs, servers and Flutter apps (language level only). Covers sound null safety, records and pattern matching, sealed classes, async/await and Streams, pub dependency management, package layout, dart analyze/format lints, and the test package. Use when editing .dart files or a project with pubspec.yaml. Flutter widget and app guidance lives in the flutter skill.
---

# Dart

Assumes Dart 3.x (sound null safety required, records, patterns, sealed/base/final class modifiers). Check `environment.sdk` in `pubspec.yaml` before using 3.3+ extension types or 3.5+ features. This skill covers the language and pub tooling; use the Flutter skill for widgets, state management and `flutter` CLI specifics.

## When to use

- Editing or creating `.dart` files, `pubspec.yaml`, `analysis_options.yaml`, `build.yaml`.
- Adding pub dependencies, tests, code generation, or CLI/server entry points.
- Reviewing Dart for null safety, async correctness, immutability or API design.

## Project conventions to detect first

1. `pubspec.yaml`: `environment.sdk` constraint, `dependencies` vs `dev_dependencies`, presence of `flutter:` section (Flutter project → use `flutter` commands instead of `dart`), `executables:` (CLI package), workspace (`workspace:` in Dart 3.5+ monorepos).
2. `analysis_options.yaml`: which lint set is included (`package:lints/recommended.yaml`, `package:flutter_lints/flutter.yaml`, `package:very_good_analysis`), `strict-casts`/`strict-inference`/`strict-raw-types` under `analyzer.language`, excluded generated files.
3. Layout: `lib/<pkg>.dart` public barrel, `lib/src/` private implementation, `bin/` executables, `test/`, `example/`, `tool/`. Generated files `*.g.dart`, `*.freezed.dart` imply `build_runner`.
4. Code generation: `json_serializable`, `freezed`, `built_value`, `riverpod_generator`, `mockito`'s `@GenerateNiceMocks`. Regenerate rather than hand-editing `.g.dart`.
5. Lockfile: `pubspec.lock` is committed for apps, usually not for packages. Version manager: `fvm` (`.fvmrc`) or `puro`.
6. Formatting: `dart format` is non-negotiable; check `formatter.page_width` (Dart 3.7+) or the `--line-length` used in CI.

## Core guidance

### Null safety

- Types are non-nullable by default; add `?` only when null is meaningful. Never use `!` where a check or `??` can express intent; comment the rare justified case.
- `late` only for values guaranteed to be initialised before use (DI, `initState`); prefer constructor initialisation. `late final` for lazy one-shot init.
- Promote with `if (x != null)`, `case`, or local `final x = this.x; if (x == null) return;` for fields (fields do not promote unless `final` and private, Dart 3.2+).
- Use `?.`, `??`, `??=` and `required` named parameters:

```dart
class User {
  const User({required this.id, required this.name, this.email});
  final String id;
  final String name;
  final String? email;
}
```

### Types, records, patterns

- `final` locals by default; `const` constructors and values wherever possible; `var` only when reassigned.
- Records for lightweight multiple returns: `(int, String) parse(String s)`; named fields `({int count, String label})`. Destructure: `final (count, label) = parse(s);`.
- Sealed class hierarchies + exhaustive `switch` expressions:

```dart
sealed class Result<T> {
  const Result();
}
final class Ok<T> extends Result<T> {
  const Ok(this.value);
  final T value;
}
final class Err<T> extends Result<T> {
  const Err(this.error);
  final Object error;
}

String describe(Result<int> r) => switch (r) {
      Ok(:final value) when value > 100 => 'big $value',
      Ok(:final value) => 'ok $value',
      Err(:final error) => 'error: $error',
    };
```

- Class modifiers: `final` (no subclassing), `base`, `interface`, `sealed`, `mixin class`. Default to `final` for concrete types in packages.
- Enhanced enums with fields and methods; `extension` methods for utilities on types you do not own; extension types (3.3+) for zero-cost wrappers.
- Immutability: `@immutable` classes with `final` fields and `copyWith`; use `freezed` if the repo already does. Collections: `List.unmodifiable`, `const []`, or `package:collection`/`fast_immutable_collections`.
- Equality: override `==` and `hashCode` together (or `Object.hash`), or use `package:equatable`/`freezed`.
- Generics with bounds `T extends Comparable<T>`; avoid `dynamic`; use `Object?` and pattern-match.

### Async and streams

- `Future<T>` + `async`/`await`; return `Future<void>` not `void` for awaitable work. Mark unawaited futures explicitly: `unawaited(f())` from `dart:async`.
- Parallel: `await Future.wait([a(), b()])` or `(await (a(), b()).wait)` record extension (Dart 3). Add timeouts with `.timeout()`.
- Errors: `try/on FormatException catch (e, st)`; rethrow with `rethrow`; `Error.throwWithStackTrace` to preserve traces. Do not catch `Error` subclasses (bugs), only `Exception`s.
- Streams: `Stream<T>` for sequences; `async*` + `yield` to produce; `await for` to consume; cancel `StreamSubscription`s in `dispose`/`close`. `StreamController.broadcast()` only when multiple listeners are needed; close controllers.
- Isolates for CPU-bound work: `await Isolate.run(() => heavyParse(data))` (Dart 2.19+).
- Zones and `runZonedGuarded` for top-level error capture in apps.

### Errors

- Throw `Exception` subclasses with messages (`class ParseException implements Exception`), never strings. `Error` subclasses (`ArgumentError`, `StateError`, `UnimplementedError`) for programmer mistakes; use `ArgumentError.checkNotNull`, `RangeError.checkValidIndex`.
- `assert` for debug-only invariants (stripped in release).
- Prefer a `Result`/sealed type for expected failures in domain code if the repo already does; otherwise exceptions.

### Style

- Effective Dart: `lowerCamelCase` members and constants, `UpperCamelCase` types, `snake_case` files and directories, `_private` members, no `get` prefixes on getters, relative imports within `lib/` or `package:` imports consistently (lint `always_use_package_imports` or `prefer_relative_imports` decides).
- Order: `dart:` imports, `package:` imports, relative imports, each group alphabetised; `export`s after imports.
- Doc comments `///` on public API; `library`-level docs optional. Use `{@template}`/`{@macro}` for shared docs.
- Trailing commas on multi-line argument lists so `dart format` produces stable vertical layouts.

## Common tasks

### Create a package or CLI

```bash
dart create -t package my_pkg        # lib/, test/, example/
dart create -t console my_cli        # bin/my_cli.dart
dart create -t server-shelf my_api   # shelf server
cd my_pkg && dart pub get
```

Public API goes in `lib/my_pkg.dart` exporting from `lib/src/`.

### Add a dependency

```bash
dart pub add http                     # runtime
dart pub add dev:test dev:mocktail    # dev
dart pub add build_runner --dev       # older syntax also works
dart pub upgrade --major-versions     # bump constraints
dart pub outdated
```

Use caret constraints (`^1.2.0`). For Flutter projects use `flutter pub add`.

### Write tests

```dart
// test/parser_test.dart
import 'package:test/test.dart';
import 'package:my_pkg/my_pkg.dart';

void main() {
  group('Parser', () {
    late Parser parser;

    setUp(() => parser = Parser(strict: true));

    test('parses key=value', () {
      expect(parser.parse('a=1'), equals({'a': '1'}));
    });

    test('throws on malformed input', () {
      expect(() => parser.parse('=='), throwsA(isA<ParseException>()));
    });

    test('async work completes', () async {
      await expectLater(parser.load(), completion(isNotEmpty));
    });
  });
}
```

Mock with `mocktail` (no codegen) or `mockito` + `build_runner`. Fake time with `package:fake_async` or `package:clock`. Run a single file: `dart test test/parser_test.dart`; by name: `dart test -N "parses key"`.

### Run code generation

```bash
dart run build_runner build --delete-conflicting-outputs
dart run build_runner watch --delete-conflicting-outputs   # during development
```

Commit generated files or not according to the repo's `.gitignore`; never edit them by hand.

### Add JSON serialisation

Hand-written: `factory User.fromJson(Map<String, dynamic> json) => User(id: json['id'] as String, ...)` and `Map<String, dynamic> toJson()`. With `json_serializable`: annotate `@JsonSerializable()`, add `part 'user.g.dart';`, run `build_runner`. Validate types at the boundary (`as String`, `as int?`) rather than trusting `dynamic`.

### Publish a package

`dart pub publish --dry-run` validates `pubspec.yaml` (description, repository, version), `CHANGELOG.md`, `LICENSE`, and the `example/`. Check the pub.dev score locally with `dart pub global activate pana && pana .`.

## Pitfalls

- `dynamic` leaking from `jsonDecode`; cast immediately or use a typed parser.
- Forgetting `await` (lint `unawaited_futures`/`discarded_futures`) or `async` without `await` (`await_only_futures`).
- Catching with bare `catch (e)` and swallowing; include the stack trace `catch (e, st)` and log or rethrow.
- Mutable `const` confusion: `const [1, 2]` is immutable and shared; `final list = []` is mutable.
- `List.generate`/`List.filled` with a shared object instance: `List.filled(3, [])` shares one list.
- Non-`final` fields not promoting to non-null; copy to a local first.
- Using `print` in libraries; use `package:logging` or return data.
- Integer division: `/` returns `double`; use `~/` for int division. Web compiles ints to 53-bit doubles.
- Circular imports between `lib/src` files; split or move shared types.
- Running `dart` commands in a Flutter project (missing `flutter` SDK packages); use `flutter test`, `flutter analyze`, `flutter pub get`.

## Verification

```bash
dart pub get
dart analyze --fatal-infos          # zero issues under the repo's lint set
dart format --output=none --set-exit-if-changed .
dart test                           # or: dart test --coverage=coverage
dart run build_runner build --delete-conflicting-outputs   # if generated code exists
dart compile exe bin/my_cli.dart -o build/my_cli           # CLI packages
dart pub publish --dry-run          # packages
```

Flutter projects: swap `dart` for `flutter` (`flutter analyze`, `flutter test`). Check `melos.yaml`, `Makefile` or `.github/workflows/*.yml` for the exact CI commands.

## References

- Dart language tour: https://dart.dev/language
- Effective Dart: https://dart.dev/effective-dart
- Null safety: https://dart.dev/null-safety/understanding-null-safety
- Patterns and records: https://dart.dev/language/patterns
- Asynchronous programming: https://dart.dev/libraries/async/async-await
- pub package layout: https://dart.dev/tools/pub/package-layout
- Linter rules: https://dart.dev/tools/linter-rules
- package:test: https://pub.dev/packages/test
