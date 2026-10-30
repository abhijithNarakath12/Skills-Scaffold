# Angular signals reference

Availability by version (verify against `@angular/core` in `package.json`):

| API | Since | Status (as of Angular 20) |
|---|---|---|
| `signal`, `computed`, `effect`, `untracked` | 16 (dev preview), 17 stable | Stable |
| `input()`, `input.required()` | 17.1 | Stable (17.2+) |
| `model()` | 17.2 | Stable |
| `output()`, `outputFromObservable`, `outputToObservable` | 17.3 | Stable |
| `viewChild`, `viewChildren`, `contentChild`, `contentChildren` | 17.2 | Stable (18+) |
| `toSignal`, `toObservable`, `takeUntilDestroyed` (`@angular/core/rxjs-interop`) | 16 | Stable |
| `afterRender`, `afterNextRender` | 16.2 | Stable (`afterRender` replaced by `afterEveryRender` in 20) |
| `@let` template variable | 18.1 | Stable |
| `linkedSignal` | 19 | Stable (20) |
| `resource`, `rxResource` | 19 | Experimental / developer preview |
| `httpResource` | 19.2 | Developer preview |
| Zoneless change detection | 18 (`provideExperimentalZonelessChangeDetection`), 20 (`provideZonelessChangeDetection`) | Developer preview; stable in 21 |

## Decorator to signal migration

| Legacy | Signal-based | Notes |
|---|---|---|
| `@Input() name: string` | `name = input<string>()` | Returns `Signal<string | undefined>`; call `name()` |
| `@Input({ required: true }) id!: string` | `id = input.required<string>()` | |
| `@Input() set value(v) {...}` | `value = input(0); effect(() => ...)` or `computed` | Setters become derived state |
| `@Input() x; @Output() xChange` | `x = model<number>()` | `[(x)]` two-way binding works; `x.set()` emits |
| `@Output() saved = new EventEmitter<T>()` | `saved = output<T>()` | `.emit()` unchanged; no RxJS methods |
| `@ViewChild('ref') ref: ElementRef` | `ref = viewChild<ElementRef>('ref')` | Signal, available after view init; `viewChild.required` |
| `@ViewChildren(Row) rows: QueryList<Row>` | `rows = viewChildren(Row)` | Returns `Signal<readonly Row[]>` |
| `BehaviorSubject` in a service | `signal()` + `asReadonly()` | Expose `readonly count = this._count.asReadonly()` |
| `route.params.subscribe(...)` | `withComponentInputBinding()` + `id = input<string>()` | Param name must match the input name |
| `obs$ \| async` | `toSignal(obs$)` | Needs `initialValue` or returns `undefined` initially; subscribe happens once |

Run the CLI migrations: `ng generate @angular/core:signal-input-migration`, `:output-migration`, `:signal-queries-migration`, `:control-flow`, `:standalone`, `:inject` (constructor params to `inject()`), `:cleanup-unused-imports`.

## Patterns

### Derived state

```ts
readonly items = signal<Item[]>([]);
readonly filter = signal('');
readonly visible = computed(() => this.items().filter(i => i.name.includes(this.filter())));
readonly count = computed(() => this.visible().length);
```

`computed` is lazy and memoised; it re-evaluates only when read after a dependency changed. Never put side effects in it.

### Resetting state when an input changes

```ts
readonly options = input.required<Option[]>();
readonly selected = linkedSignal(() => this.options()[0] ?? null); // 19+
// pre-19: effect(() => { this.options(); untracked(() => this.selected.set(this.options()[0] ?? null)); });
```

### Effects

```ts
constructor() {
  effect(() => {
    const id = this.userId();
    untracked(() => this.analytics.track('view', id)); // reads inside untracked are not dependencies
  });
}
```

- Create in constructor/field initialiser, or pass `{ injector }` when created elsewhere.
- Use for logging, syncing to `localStorage`, imperative DOM libraries. Do not use to copy one signal into another; use `computed`/`linkedSignal`.
- Effects run during change detection in 19+ (component effects before the template, root effects as microtasks); in 17/18 they ran as microtasks. Test with `TestBed.flushEffects()` (renamed `TestBed.tick()` in 20) or `fixture.detectChanges()`.

### RxJS interop

```ts
readonly query = signal('');
readonly results = toSignal(
  toObservable(this.query).pipe(debounceTime(300), distinctUntilChanged(), switchMap(q => this.api.search(q))),
  { initialValue: [] as Result[] },
);
```

`toObservable` emits in an effect, so it needs an injection context (constructor/field). `toSignal` subscribes immediately and unsubscribes on destroy; pass `requireSync: true` for `BehaviorSubject`-like sources to avoid `undefined`.

### Signal stores

- Small apps: a `providedIn: 'root'` service with private writable signals and public `asReadonly()`/`computed` views, plus methods for mutations.
- Larger apps already on NgRx: `@ngrx/signals` `signalStore(withState, withComputed, withMethods, withHooks)`; `patchState(store, { ... })` for updates.

### Testing signals

```ts
const fixture = TestBed.createComponent(CounterComponent);
fixture.componentRef.setInput('start', 5);   // for input() signals
fixture.detectChanges();
fixture.componentInstance.increment();
fixture.detectChanges();                     // OnPush + signals: CD runs when a template-read signal changes
expect(fixture.nativeElement.textContent).toContain('6');
```

Read a component signal directly in tests (`component.count()`); for effects call `TestBed.flushEffects()` (or `TestBed.tick()` on 20+) after changing inputs.
