# Flutter state management by library

Detect from `pubspec.yaml`, then use that library's idioms. Never introduce a second one.

| Library | Detect | Root setup | Read in widget | Mutate |
|---|---|---|---|---|
| Riverpod | `flutter_riverpod` / `hooks_riverpod`, `riverpod_annotation` | `ProviderScope(child: App())` | `ConsumerWidget` + `ref.watch(provider)` | `ref.read(provider.notifier).method()` |
| Provider | `provider` | `MultiProvider(providers: [...], child: App())` | `context.watch<T>()`, `Consumer<T>`, `Selector<T, R>` | `context.read<T>().method()` |
| Bloc/Cubit | `flutter_bloc`, `bloc`, `bloc_test` | `BlocProvider(create: (_) => XBloc(), child: ...)` / `MultiBlocProvider` | `BlocBuilder<XBloc, XState>`, `BlocSelector`, `context.watch<XBloc>().state` | `context.read<XBloc>().add(Event())` / `cubit.method()` |
| GetX | `get` | `GetMaterialApp`, `Get.put(Controller())` or bindings | `Obx(() => Text(c.count.value.toString()))`, `GetBuilder` | `c.count.value++`, `update()` |
| Built-in | none of the above | `InheritedWidget`/constructor injection | `ValueListenableBuilder`, `ListenableBuilder`, `AnimatedBuilder` | `notifier.value = x`, `notifyListeners()` |

## Riverpod (2.x, codegen or manual)

```dart
// manual
final productsProvider = FutureProvider.autoDispose<List<Product>>((ref) => ref.watch(repoProvider).fetchAll());

class CartNotifier extends Notifier<List<Item>> {
  @override List<Item> build() => [];
  void add(Item i) => state = [...state, i];
}
final cartProvider = NotifierProvider<CartNotifier, List<Item>>(CartNotifier.new);

// codegen (riverpod_annotation + riverpod_generator); run build_runner
@riverpod
Future<List<Product>> products(Ref ref) => ref.watch(repoProvider).fetchAll();

@riverpod
class Cart extends _$Cart {
  @override List<Item> build() => [];
  void add(Item i) => state = [...state, i];
}
```

```dart
class ProductsScreen extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final products = ref.watch(productsProvider);
    return products.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, st) => ErrorView(e, onRetry: () => ref.invalidate(productsProvider)),
      data: (list) => ListView.builder(itemCount: list.length, itemBuilder: (_, i) => ProductTile(product: list[i])),
    );
  }
}
```

- `ref.watch` in `build`, `ref.read` in callbacks, `ref.listen` for side effects (snackbars, navigation). `.select((s) => s.field)` to narrow rebuilds.
- `AsyncNotifier` for async state with mutations; `AsyncValue.guard(() async => ...)` to set `state` safely.
- Providers are global final variables; dependencies via `ref.watch` inside providers. `autoDispose` for screen-scoped data; `family` for parameterised providers (`ref.watch(productProvider(id))`).
- Testing: `final container = ProviderContainer(overrides: [repoProvider.overrideWithValue(FakeRepo())]); addTearDown(container.dispose); await container.read(productsProvider.future);`. In widget tests wrap with `ProviderScope(overrides: [...])`.
- Riverpod 3 (2025) renames some APIs (`Ref` is unified, `StateProvider`/`ChangeNotifierProvider` moved to `legacy`); check the installed major and https://riverpod.dev/docs/whats_new.

## Provider

```dart
class CartModel extends ChangeNotifier {
  final _items = <Item>[];
  List<Item> get items => List.unmodifiable(_items);
  void add(Item i) { _items.add(i); notifyListeners(); }
}

MultiProvider(providers: [
  ChangeNotifierProvider(create: (_) => CartModel()),
  Provider<Api>(create: (_) => Api()),
  ProxyProvider<Api, Repo>(update: (_, api, __) => Repo(api)),
], child: const App());

// read
final count = context.select<CartModel, int>((c) => c.items.length);  // rebuild only when length changes
context.read<CartModel>().add(item);                                   // in callbacks
```

- `context.watch` only in `build`; `context.read` in handlers; `Selector`/`select` to scope rebuilds.
- `ChangeNotifierProvider.value` when reusing an existing instance (list items), `create:` otherwise.
- `FutureProvider`/`StreamProvider` exist but are limited; a `ChangeNotifier` with a status field is the common pattern.
- Testing: wrap the widget under test in the same providers with fakes.

## Bloc / Cubit

```dart
sealed class ProductsState { const ProductsState(); }
final class ProductsLoading extends ProductsState { const ProductsLoading(); }
final class ProductsLoaded extends ProductsState { const ProductsLoaded(this.items); final List<Product> items; }
final class ProductsError extends ProductsState { const ProductsError(this.message); final String message; }

class ProductsCubit extends Cubit<ProductsState> {
  ProductsCubit(this._repo) : super(const ProductsLoading());
  final Repo _repo;
  Future<void> load() async {
    emit(const ProductsLoading());
    try { emit(ProductsLoaded(await _repo.fetchAll())); } catch (e) { emit(ProductsError(e.toString())); }
  }
}

BlocProvider(create: (_) => ProductsCubit(context.read<Repo>())..load(), child: const ProductsView());

BlocBuilder<ProductsCubit, ProductsState>(builder: (context, state) => switch (state) {
  ProductsLoading() => const CircularProgressIndicator(),
  ProductsLoaded(:final items) => ProductList(items),
  ProductsError(:final message) => ErrorView(message),
});
```

- Cubit for simple method-driven state; Bloc (`on<Event>(handler)`) when events need transformation (`debounce`, `restartable()` via `bloc_concurrency`).
- States immutable and comparable (`Equatable` or `freezed`) so identical emits are skipped.
- `BlocListener` for one-off side effects, `BlocConsumer` for both, `BlocSelector` for narrow rebuilds. `RepositoryProvider` for dependencies.
- Testing: `blocTest<ProductsCubit, ProductsState>('loads', build: () => ProductsCubit(fakeRepo), act: (c) => c.load(), expect: () => [isA<ProductsLoading>(), isA<ProductsLoaded>()])`.
- `BlocObserver` for global logging.

## GetX

```dart
class CartController extends GetxController {
  final items = <Item>[].obs;
  void add(Item i) => items.add(i);
}
Get.put(CartController());                    // or lazyPut in a Bindings
Obx(() => Text('${Get.find<CartController>().items.length}'));
```

- `.obs` values with `Obx`/`GetX` builders; `GetBuilder` + `update()` for manual notification.
- GetX also owns routing (`Get.to`, `GetPage`) and DI; keep usage consistent with the project. Avoid introducing GetX into non-GetX projects: it bypasses the widget tree and complicates testing.

## Built-in (no package)

```dart
final counter = ValueNotifier<int>(0);
ValueListenableBuilder<int>(valueListenable: counter, builder: (_, value, __) => Text('$value'));
counter.value++;
```

- `ChangeNotifier` + `ListenableBuilder` (3.10+) for multi-field models; pass instances down the constructor chain or expose via an `InheritedWidget`/`InheritedNotifier`.
- Scales to small apps and isolated widgets (e.g. a form section); adopt Riverpod or Bloc when state crosses many screens.

## Choosing rebuild scope (all libraries)

1. Find the widget that actually displays the changing value.
2. Wrap only that widget in the library's builder/consumer.
3. Keep `const` siblings outside the builder so they are not rebuilt.
4. Verify with DevTools "Track widget rebuilds" or `debugPrintRebuildDirtyWidgets`.
