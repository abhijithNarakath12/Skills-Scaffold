---
name: flutter
description: Build and maintain Flutter 3.x apps in Dart: widget tree and composition, StatelessWidget/StatefulWidget, state management detection and idioms (Riverpod, Provider, Bloc, GetX, built-in ValueNotifier), navigation with go_router, Futures/Streams/isolates, Material 3 theming, platform channels and plugins, widget/integration/golden tests, the flutter CLI and release builds. Use when a project has pubspec.yaml depending on flutter, or when editing .dart files under lib/ or test/.
---

# Flutter

Assumes Flutter 3.22+ with Dart 3 (sound null safety, records, patterns, sealed classes) and Material 3 as the default theme. Check `flutter --version` and the `sdk`/`flutter` constraints in `pubspec.yaml`. Language-level Dart guidance belongs to the `dart` skill.

## When to use

- Creating or changing widgets, screens, layouts, themes, animations.
- Managing state, async data, navigation, forms, localisation.
- Integrating native code (platform channels, plugins, FFI) or platform-specific config (`android/`, `ios/`, `web/`, `macos/`, `windows/`, `linux/`).
- Writing widget, unit, golden and integration tests; running, building and releasing.

## Project conventions to detect first

1. `pubspec.yaml`: Flutter/Dart constraints, `dependencies` and `dev_dependencies`. Identify, and then reuse, the existing choices for:
   - State: `flutter_riverpod`/`hooks_riverpod` (+ `riverpod_annotation`, `riverpod_generator`), `provider`, `flutter_bloc` (+ `bloc`, `equatable`/`freezed`), `get`, `mobx`, `signals`, or none (`setState`, `ValueNotifier`, `InheritedWidget`). See [references/state-management.md](references/state-management.md).
   - Navigation: `go_router` (+ `go_router_builder`), `auto_route`, `beamer`, or `Navigator` 1.0 named routes.
   - Models/codegen: `freezed`, `json_serializable`, `build_runner`; DI: `get_it` (+ `injectable`); networking: `dio`, `http`, `retrofit`, `graphql_flutter`; storage: `shared_preferences`, `hive`/`isar`/`drift`/`sqflite`, `flutter_secure_storage`.
   - Lints: `flutter_lints`, `very_good_analysis`, custom rules in `analysis_options.yaml`.
   - i18n: `flutter_localizations` + `intl` with `l10n.yaml` (`flutter gen-l10n`), or `easy_localization`.
   - Flavors: `--flavor` usage, `--dart-define`/`--dart-define-from-file`, `flutter_flavorizr`.
2. Folder layout in `lib/`: feature-first (`lib/features/<feature>/{data,domain,presentation}`), layer-first (`lib/models`, `lib/screens`, `lib/widgets`, `lib/services`), or Very Good CLI structure. Follow it exactly.
3. Codegen presence: `*.g.dart`/`*.freezed.dart` committed or gitignored; `build.yaml`. If generated files are gitignored, run `dart run build_runner build -d` after cloning and after model changes.
4. Testing setup: `test/` (unit + widget), `integration_test/`, `test/goldens` or `golden_toolkit`/`alchemist`, `mocktail` vs `mockito`, `bloc_test`, `riverpod` test utilities (`ProviderContainer`).
5. Platform targets enabled (folders present) and `flutter_native_splash`/`flutter_launcher_icons` configs. Minimum SDKs: `android/app/build.gradle(.kts)` `minSdk`, `ios/Podfile` platform, `ios/Runner.xcodeproj` deployment target.
6. CI scripts and tooling: `Makefile`, `melos.yaml` (monorepo), `fvm` (`.fvmrc`/`.fvm/`), `very_good` CLI, `mason`.

## Core guidance

### Widgets and layout

```dart
class ProductTile extends StatelessWidget {
  const ProductTile({super.key, required this.product, this.onTap});

  final Product product;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListTile(
      leading: Image.network(product.imageUrl, width: 48, height: 48, fit: BoxFit.cover),
      title: Text(product.name, style: theme.textTheme.titleMedium),
      subtitle: Text(product.price.toStringAsFixed(2)),
      trailing: const Icon(Icons.chevron_right),
      onTap: onTap,
    );
  }
}
```

- Prefer `StatelessWidget` and push state outward; use `StatefulWidget` for ephemeral UI state (animation controllers, text controllers, focus, scroll). Dispose controllers in `dispose()`.
- Compose small widgets as separate classes, not private `_buildX()` methods: classes get their own `BuildContext`, can be `const`, and rebuild independently.
- `const` constructors everywhere possible (`prefer_const_constructors`); pass `super.key`.
- `build()` must be pure and fast: no I/O, no `Future` creation, no `setState` calls. Start futures in `initState` or a state manager.
- Layout: `Column`/`Row` with `Expanded`/`Flexible`/`Spacer`; `SizedBox` for fixed gaps; `Padding`; `Stack`/`Positioned`; `LayoutBuilder` and `MediaQuery.sizeOf(context)` (not `MediaQuery.of(context).size`, which rebuilds on every metric change) for responsiveness; `Wrap` for flowing chips.
- Scrolling: `ListView.builder`/`separated`, `GridView.builder`, `CustomScrollView` + slivers (`SliverAppBar`, `SliverList.builder`). Avoid `shrinkWrap: true` and nested unbounded scrollables; avoid `Column` inside `SingleChildScrollView` for long lists.
- Overflow errors (`RenderFlex overflowed`) mean an unbounded child: wrap in `Expanded`/`Flexible` or give a bounded size.
- Text: `Text.rich`/`TextSpan`, `overflow: TextOverflow.ellipsis` + `maxLines`; `SelectableText` where copyable.
- Images: `Image.asset` with assets declared in `pubspec.yaml`, `Image.network` with `errorBuilder`/`loadingBuilder`, `cached_network_image` when caching matters; `flutter_svg` for SVG.
- Accessibility: `Semantics` labels on icon buttons, `tooltip` on `IconButton`, `MergeSemantics`, minimum 48dp touch targets, support text scaling (`MediaQuery.textScalerOf`).

### Material 3 theming

```dart
MaterialApp.router(
  theme: ThemeData(colorSchemeSeed: const Color(0xFF3F51B5), brightness: Brightness.light),
  darkTheme: ThemeData(colorSchemeSeed: const Color(0xFF3F51B5), brightness: Brightness.dark),
  themeMode: ThemeMode.system,
  routerConfig: router,
);
```

- Read colours from `Theme.of(context).colorScheme` (`primary`, `onPrimary`, `surface`, `surfaceContainerHighest`, `error`) and text from `textTheme`; no hard-coded colours in widgets.
- Component themes (`ElevatedButtonThemeData`, `InputDecorationTheme`, `CardTheme`) in one `app_theme.dart`; custom tokens via `ThemeExtension<T>` and `Theme.of(context).extension<T>()`.
- `useMaterial3` defaults to true since 3.16; legacy `primarySwatch`/`accentColor` are deprecated. Cupertino widgets or `.adaptive` constructors (`Switch.adaptive`) for platform-adaptive UI.

### State management

Pick by what `pubspec.yaml` already contains; never introduce a second solution. Idioms per library in [references/state-management.md](references/state-management.md). Shared rules:

- Keep business logic out of widgets; widgets map state to UI and dispatch intents.
- Model async data as a sealed/union type (`AsyncValue` in Riverpod, `sealed class` states in Bloc, a `Status` enum in Provider) and render loading/error/data branches explicitly.
- Scope rebuilds: `Consumer`/`Selector`/`ref.watch(provider.select(...))`/`BlocSelector`/`ValueListenableBuilder` around the smallest subtree that changes.
- Immutable state objects (`freezed` or `copyWith`); never mutate a list inside state and expect listeners to fire.
- Built-in option for small apps: `ChangeNotifier`/`ValueNotifier` exposed via an `InheritedWidget` or constructor injection, consumed with `ListenableBuilder`/`ValueListenableBuilder`.

### Navigation with go_router

```dart
final router = GoRouter(
  initialLocation: '/',
  redirect: (context, state) => auth.isLoggedIn || state.matchedLocation == '/login' ? null : '/login',
  routes: [
    StatefulShellRoute.indexedStack(
      builder: (context, state, shell) => AppScaffold(shell: shell),
      branches: [
        StatefulShellBranch(routes: [GoRoute(path: '/', builder: (c, s) => const HomeScreen())]),
        StatefulShellBranch(routes: [
          GoRoute(path: '/products', builder: (c, s) => const ProductsScreen(), routes: [
            GoRoute(path: ':id', builder: (c, s) => ProductScreen(id: s.pathParameters['id']!)),
          ]),
        ]),
      ],
    ),
    GoRoute(path: '/login', builder: (c, s) => const LoginScreen()),
  ],
  errorBuilder: (c, s) => NotFoundScreen(uri: s.uri),
);
```

- `MaterialApp.router(routerConfig: router)`. Navigate with `context.go('/products/1')` (replace stack), `context.push(...)` (stack), `context.pop(result)`; read `state.pathParameters`, `state.uri.queryParameters`, `state.extra` (not for web deep links).
- `redirect` for auth/onboarding gates; `refreshListenable` so redirects re-run on auth changes.
- `go_router_builder` gives typed routes (`ProductRoute(id: '1').go(context)`); use it if present.
- Navigator 1.0 (`Navigator.push(MaterialPageRoute(...))`, `onGenerateRoute`) is fine inside legacy apps; dialogs and bottom sheets still use `showDialog`/`showModalBottomSheet`.

### Async, futures, streams, isolates

- Start async work in `initState`, a provider/bloc, or an event handler; store the `Future` in a field and pass it to `FutureBuilder` so rebuilds do not restart it. Prefer the state manager's async primitives over `FutureBuilder` in app code.
- After every `await` in a `State`, check `if (!mounted) return;` before `setState` or using `context` (`use_build_context_synchronously` lint).
- Streams: `StreamBuilder` for UI, `StreamSubscription` cancelled in `dispose`, `StreamController.broadcast()` for multiple listeners; prefer `rxdart` only if already present.
- CPU-heavy work (JSON parsing of large payloads, image processing) goes to an isolate: `await compute(parseJson, body)` or `await Isolate.run(() => parse(body))` (Dart 2.19+). Isolates do not share memory; pass simple data.
- Error handling: `try/catch` around awaits, surface via state; `FlutterError.onError` and `PlatformDispatcher.instance.onError` in `main` for crash reporting (`firebase_crashlytics`, `sentry_flutter`).
- `runApp` after `WidgetsFlutterBinding.ensureInitialized()` when awaiting plugins in `main`.

### Forms

- `Form` + `GlobalKey<FormState>` + `TextFormField(validator:)`; `autovalidateMode: AutovalidateMode.onUserInteraction`; `formKey.currentState!.validate()` then `save()`.
- `TextEditingController` and `FocusNode` live in `State` and are disposed. For large forms consider `flutter_form_builder` or `reactive_forms` if already present.

### Platform channels and plugins

```dart
// Dart
static const _channel = MethodChannel('com.example.app/battery');
Future<int> batteryLevel() async => (await _channel.invokeMethod<int>('getBatteryLevel'))!;
```

```kotlin
// android/app/src/main/kotlin/.../MainActivity.kt
override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
  super.configureFlutterEngine(flutterEngine)
  MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "com.example.app/battery").setMethodCallHandler { call, result ->
    if (call.method == "getBatteryLevel") result.success(getBatteryLevel()) else result.notImplemented()
  }
}
```

- `MethodChannel` for request/response, `EventChannel` for streams, `BasicMessageChannel` for raw messages. Channel names must match exactly; wrap `invokeMethod` in `try/on PlatformException`.
- `pigeon` generates type-safe channel code for both sides; prefer it for anything beyond one or two methods. `dart:ffi` + `ffigen` for C libraries; `jnigen`/`objective_c` for direct JVM/ObjC bindings (newer, check stability).
- New plugins: `flutter create --template=plugin --platforms=android,ios --org com.example my_plugin` (federated plugin layout for multiple platforms). App-local native code can live in the app's `android/`/`ios/` folders.
- Always test on both platforms; `result.notImplemented()` paths and missing `Info.plist` usage descriptions are the common failures.

### Performance

- Profile in profile mode (`flutter run --profile`) with DevTools (Performance, CPU profiler, Widget rebuild counts); debug mode numbers are meaningless.
- `const` widgets, split rebuilding subtrees, `RepaintBoundary` around frequently repainting animations, avoid `Opacity`/`ClipRRect` in animations (use `FadeTransition`, `AnimatedOpacity` sparingly), `ListView.builder` with `itemExtent`/`prototypeItem`, cache images at display size (`cacheWidth`).
- Avoid `MediaQuery.of(context)` in deep widgets; use the `sizeOf`/`paddingOf` accessors.
- Impeller is the default renderer on iOS (3.10+) and Android (3.27+ on API 29+); shader jank workarounds from the Skia era are unnecessary.
- App size: `flutter build apk --analyze-size`, `--split-per-abi`, tree-shaken icons by default, deferred components for large optional features.

## Common tasks

### Add a screen

1. Create `lib/features/<feature>/presentation/<name>_screen.dart` (or the project's layout) as a `StatelessWidget`/`ConsumerWidget`/`BlocProvider` wrapper per the state library.
2. Register a `GoRoute` (and typed route if `go_router_builder`), link from the caller with `context.go`/`push`.
3. Wire data via the existing state solution; render loading/error/data states.
4. Widget test in `test/features/<feature>/<name>_screen_test.dart` using a `pumpApp` helper that provides theme, localisation and the state scope.

### Add a model and API call

1. Define the model (`freezed` + `json_serializable` if used; otherwise a `final` class with `fromJson`/`toJson` and `copyWith`). Run `dart run build_runner build -d` for codegen.
2. Repository/service method using `dio`/`http`; map errors to typed failures.
3. Expose through a provider/bloc/notifier; consume in the widget with the appropriate builder.
4. Unit test the repository with a mocked client (`mocktail`); test the notifier/bloc with `ProviderContainer` or `blocTest`.

### Add a dependency

1. `flutter pub add <package>` (`--dev` for tooling); check platform support and null safety on pub.dev; `flutter pub outdated` before bumping.
2. Platform setup from the package README: permissions (`AndroidManifest.xml`, `Info.plist`), `minSdk`, Podfile platform, Gradle plugins.
3. Run `flutter clean && flutter pub get` if the build breaks after native changes; `cd ios && pod install --repo-update` for CocoaPods mismatches.

### Write tests

```dart
testWidgets('adds item to cart', (tester) async {
  await tester.pumpWidget(const ProviderScope(child: MaterialApp(home: ProductScreen(id: '1'))));
  await tester.pumpAndSettle();                       // wait for async providers
  await tester.tap(find.byKey(const Key('add-to-cart')));
  await tester.pump();
  expect(find.text('1 item'), findsOneWidget);
});
```

- Unit tests for pure Dart (`test` package); widget tests with `testWidgets`, `find.byType/byKey/text`, `tester.tap/enterText/drag`, `pump` (one frame) vs `pumpAndSettle` (until idle; hangs on infinite animations, use `pump(Duration)` instead).
- Golden tests: `await expectLater(find.byType(Card), matchesGoldenFile('card.png'))`; update with `flutter test --update-goldens`; pin fonts and device size for determinism (`golden_toolkit`/`alchemist` if present).
- Integration: `integration_test/app_test.dart` with `IntegrationTestWidgetsFlutterBinding.ensureInitialized()`, run via `flutter test integration_test -d <device>`; `patrol` for native interactions if installed.
- Mock HTTP at the client boundary (`MockDio`, `http.MockClient`), platform channels with `TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler`.

### Release build

- Android: signing in `android/key.properties` + `build.gradle(.kts)` `signingConfigs`; `flutter build appbundle --release --flavor prod --dart-define-from-file=env/prod.json`; `--obfuscate --split-debug-info=build/symbols` for release.
- iOS: `flutter build ipa --release --export-options-plist=ios/ExportOptions.plist` (needs Xcode signing configured); or open `ios/Runner.xcworkspace` and archive.
- Web: `flutter build web --release` (`--wasm` for WasmGC if dependencies support it); desktop: `flutter build macos|windows|linux`.
- Version from `pubspec.yaml` `version: 1.2.3+45` (`--build-name`/`--build-number` override).

## Pitfalls

- Creating a `Future` or `Stream` inside `build` (restarts on every rebuild); create once in `initState` or a provider.
- Using `BuildContext` after an `await` without checking `mounted`; `setState` after dispose.
- `MediaQuery.of(context).size` in many widgets (global rebuilds on keyboard/rotation); use `MediaQuery.sizeOf`.
- Non-`const` widget trees and giant `build` methods with `_buildX` helpers (whole-screen rebuilds).
- `shrinkWrap: true` lists or `ListView` inside `Column` without `Expanded` (layout errors or jank).
- Mutating state objects in place with Provider/Bloc and wondering why nothing updates; emit new instances.
- Mixing two state libraries, or reaching for `GetX` globals in a Riverpod/Bloc codebase.
- `pumpAndSettle` timeouts caused by indefinite animations (`CircularProgressIndicator`); pump fixed durations.
- Hard-coded colours/sizes instead of `Theme.of(context)` tokens; ignoring text scaling.
- Forgetting `WidgetsFlutterBinding.ensureInitialized()` before plugin calls in `main`.
- Storing secrets in Dart code or `--dart-define` values that ship in the binary (they are extractable); use a backend.
- Stale generated files after model edits; rerun `build_runner` (and use `watch` during development).
- Committing `ios/Pods/`; not committing `pubspec.lock` for apps (apps should commit it, packages should not).

## Verification

```bash
flutter --version && flutter doctor -v          # toolchain health
flutter pub get
dart run build_runner build --delete-conflicting-outputs   # only if codegen is used
flutter analyze                                 # lints from analysis_options.yaml
dart format --set-exit-if-changed .
flutter test --coverage                         # unit + widget tests
flutter test integration_test -d <device-id>    # integration tests on a device/emulator (flutter devices)
flutter build apk --debug                       # or: flutter build ios --no-codesign; verifies native project compiles
flutter run -d <device-id>                      # manual check; r = hot reload, R = hot restart
```

Discover project-specific commands in `Makefile`, `melos.yaml`, `.github/workflows/*.yml`, or `scripts/`.

## References

- [references/state-management.md](references/state-management.md): idioms and detection cues for Riverpod, Provider, Bloc, GetX and built-in options.
- Flutter docs: https://docs.flutter.dev
- Widget catalog and layout: https://docs.flutter.dev/ui/widgets, https://docs.flutter.dev/ui/layout
- State management overview: https://docs.flutter.dev/data-and-backend/state-mgmt/options
- go_router: https://pub.dev/documentation/go_router/latest/
- Platform channels: https://docs.flutter.dev/platform-integration/platform-channels ; Pigeon: https://pub.dev/packages/pigeon
- Testing: https://docs.flutter.dev/testing/overview, https://docs.flutter.dev/cookbook/testing/widget/introduction
- Performance best practices: https://docs.flutter.dev/perf/best-practices
- Release: https://docs.flutter.dev/deployment/android, https://docs.flutter.dev/deployment/ios
