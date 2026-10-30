---
name: angular
description: Build and maintain Angular 17+ applications with standalone components, signals (signal, computed, effect, input, output, model), built-in control flow (@if/@for/@switch/@defer), inject()-based DI, RxJS interop, the Router, typed reactive forms, HttpClient with functional interceptors, Angular CLI, and testing with Jest/Karma/Vitest and Testing Library. Use when a project depends on @angular/core or contains angular.json, or when editing .component.ts, .service.ts or Angular templates.
---

# Angular

Assumes Angular 17 or later (standalone APIs, signals, new control flow, esbuild-based `application` builder). Version-specific details are flagged; check `ng version` or `@angular/core` in `package.json`. NgModules, `*ngIf`/`*ngFor`, and `@Input()` decorators are legacy: keep them working in existing code, do not add them to new code.

## When to use

- Creating or changing components, directives, pipes, services, routes, guards, interceptors.
- State with signals vs RxJS, change detection problems, template syntax.
- Forms (reactive, typed), HTTP calls, error handling, SSR/hydration.
- Running the CLI (generate, build, test, update) and writing unit/component tests.

## Project conventions to detect first

1. Version in `package.json` (`@angular/core`). Capabilities by version: 17 standalone defaults in CLI + control flow + `@defer`; 17.1-17.3 `input()`, `output()`, `model()`, `viewChild()`; 18 `@let` (18.1), zoneless experimental; 19 standalone is the default (no `standalone: true` needed), `linkedSignal`, `resource()` experimental, incremental hydration; 20 `resource`/`httpResource` in developer preview, zoneless developer preview, Vitest unit-test builder experimental. See [references/signals.md](references/signals.md).
2. `angular.json`: builder (`@angular/build:application` or `@angular-devkit/build-angular:application` is esbuild; `browser` is legacy webpack), `ssr` entry, `test` builder (Karma, `@angular/build:unit-test`), style preprocessor, `schematics` defaults (prefix, style, `skipTests`).
3. Standalone vs NgModule: look for `app.config.ts` + `bootstrapApplication` (standalone) versus `app.module.ts` + `platformBrowserDynamic().bootstrapModule`. Follow what exists; migrate with `ng generate @angular/core:standalone` only as a deliberate task.
4. Change detection: `ChangeDetectionStrategy.OnPush` usage, zoneless (`provideExperimentalZonelessChangeDetection` / `provideZonelessChangeDetection`), `zone.js` in `polyfills`.
5. State: plain signal services, NgRx (`@ngrx/store`, `@ngrx/signals` SignalStore), NGXS, Akita, RxJS `BehaviorSubject` services. Do not introduce a second store.
6. UI/styling: Angular Material + CDK, PrimeNG, Tailwind, SCSS; `styleUrl` (17+, singular) vs `styleUrls`.
7. Testing: `karma.conf.js` (Karma + Jasmine, deprecated from Angular 20 but still default in older projects), `jest.config.*` with `jest-preset-angular`, Vitest via `@angular/build:unit-test` or Analog's `@analogjs/vitest-angular`, `@testing-library/angular`, Cypress/Playwright.
8. Lint: `angular-eslint` (`eslint.config.js` with `@angular-eslint/*` rules; selector prefix rules). Format: Prettier.
9. SSR: `@angular/ssr` with `server.ts`, `provideClientHydration()`.

## Core guidance

### Standalone components

```ts
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { CartService } from './cart.service';

@Component({
  selector: 'app-product-card',
  imports: [CurrencyPipe],              // standalone: true is implicit from 19; add it on 17/18
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-card.component.html',
  styleUrl: './product-card.component.scss',
  host: { class: 'card', '(keydown.escape)': 'close()' },
})
export class ProductCardComponent {
  readonly product = input.required<Product>();
  readonly compact = input(false);
  readonly added = output<Product>();

  private readonly cart = inject(CartService);
  protected readonly qty = signal(1);
  protected readonly total = computed(() => this.product().price * this.qty());

  add() { this.cart.add(this.product(), this.qty()); this.added.emit(this.product()); }
}
```

- `imports` lists every component, directive and pipe the template uses. Do not import `CommonModule` wholesale when only `AsyncPipe`/`DatePipe` are needed; with built-in control flow you rarely need `NgIf`/`NgFor`.
- `OnPush` on every component. With signals in templates this is safe and fast; with mutable objects you must replace references.
- Prefer `host: {}` metadata over `@HostBinding`/`@HostListener`; prefer `inject()` in field initialisers over constructor parameters.
- Signal-based inputs/outputs/queries (`input`, `output`, `model`, `viewChild`, `contentChildren`) over decorators. Migrate existing code with `ng generate @angular/core:signal-input-migration` and `:output-migration`.
- Protected members for template-only state; keep templates free of complex expressions and function calls that allocate.

### Signals

- `signal(initial)`, read with `count()`, write with `set`/`update`. `computed()` derives lazily and memoises. `effect()` runs side effects when dependencies change; create it in a constructor or field initialiser (injection context) and avoid writing other signals inside it (use `computed` or `linkedSignal` instead; `allowSignalWrites` was removed in 19 when writes became allowed but still discouraged).
- `linkedSignal(() => source())` (19+) for writable state that resets when a source changes (selected item resets when the list changes).
- RxJS interop (`@angular/core/rxjs-interop`): `toSignal(obs$, { initialValue })` to consume streams in templates; `toObservable(sig)` to feed signals into operators; `takeUntilDestroyed()` for subscriptions.
- `resource({ params, loader })` / `rxResource` / `httpResource` (19/20) are developer preview; use them only if the project already does, and check https://angular.dev/guide/signals/resource for the current signature.
- Equality: signals holding objects compare by reference; set a custom `equal` or replace objects immutably.
- Details and migration table: [references/signals.md](references/signals.md).

### Templates and control flow

```html
@if (user(); as u) {
  <p>Hello {{ u.name }}</p>
} @else if (loading()) {
  <app-spinner />
} @else {
  <a routerLink="/login">Sign in</a>
}

@for (item of items(); track item.id) {
  <app-row [item]="item" (removed)="remove($event)" />
} @empty {
  <p>No items</p>
}

@switch (status()) { @case ('ok') { <span>OK</span> } @default { <span>Unknown</span> } }

@defer (on viewport; prefetch on idle) {
  <app-heavy-chart [data]="chartData()" />
} @placeholder { <div class="skeleton"></div> } @loading (minimum 300ms) { <app-spinner /> }

@let total = price() * qty();   <!-- 18.1+ -->
```

- `track` is mandatory in `@for`; use a stable identity (`item.id`), never `$index` for lists that reorder, and never the object itself unless it is immutable and stable.
- Property `[prop]`, event `(event)`, two-way `[(ngModel)]`/`[(value)]` with `model()` inputs. Self-closing tags are allowed from 16.
- Migrate legacy templates with `ng generate @angular/core:control-flow`.
- Pipes for formatting (`date`, `currency`, `async`); pure pipes are memoised. Avoid method calls that build arrays/objects in templates.

### Dependency injection

- `@Injectable({ providedIn: 'root' })` for singletons; component-level `providers` only for per-instance state.
- `inject(Token)` works in constructors, field initialisers, factory functions, guards, resolvers, interceptors and `runInInjectionContext`. It does not work in lifecycle hooks or event handlers.
- `InjectionToken<T>` with a `factory` for configuration; `provideX()` functions (`provideHttpClient`, `provideRouter`, `provideAnimationsAsync`) in `app.config.ts`.
- `DestroyRef` (`inject(DestroyRef).onDestroy(...)`) instead of `ngOnDestroy` when inside composable functions.

### Routing

```ts
export const routes: Routes = [
  { path: '', component: HomeComponent, title: 'Home' },
  { path: 'users/:id', loadComponent: () => import('./user/user.component').then(m => m.UserComponent), canActivate: [authGuard] },
  { path: 'admin', loadChildren: () => import('./admin/admin.routes').then(m => m.ADMIN_ROUTES) },
  { path: '**', component: NotFoundComponent },
];

export const authGuard: CanActivateFn = () => inject(AuthService).isLoggedIn() || inject(Router).createUrlTree(['/login']);

// app.config.ts
provideRouter(routes, withComponentInputBinding(), withViewTransitions(), withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }));
```

- `withComponentInputBinding()` binds route params, query params and resolver data to `input()`s of the same name (`readonly id = input.required<string>()`), removing most `ActivatedRoute` subscriptions.
- Lazy-load every feature with `loadComponent`/`loadChildren`. Functional guards and resolvers (`CanActivateFn`, `ResolveFn`); class guards are deprecated.
- Route `title` or a `TitleStrategy`. `RouterLink`, `RouterLinkActive`, `RouterOutlet` must be in `imports`.

### Forms (reactive, typed)

```ts
private readonly fb = inject(NonNullableFormBuilder);
readonly form = this.fb.group({
  email: ['', [Validators.required, Validators.email]],
  password: ['', [Validators.required, Validators.minLength(8)]],
});
submit() {
  if (this.form.invalid) { this.form.markAllAsTouched(); return; }
  const { email, password } = this.form.getRawValue(); // typed, non-nullable
}
```

- `ReactiveFormsModule` in `imports`; `[formGroup]`, `formControlName`. Use `NonNullableFormBuilder` so `reset()` returns defaults rather than `null`.
- Custom validators are pure functions `(control) => ValidationErrors | null`; async validators return `Observable`/`Promise`. Cross-field validators go on the group.
- Show errors with `control.touched && control.invalid`; link messages with `aria-describedby`. Template-driven forms (`FormsModule`, `ngModel`) only for trivial inputs.
- Signal Forms are experimental (Angular 21); do not use them unless the project already does.

### HttpClient and RxJS

```ts
// app.config.ts
provideHttpClient(withFetch(), withInterceptors([authInterceptor, errorInterceptor]));

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthService).token();
  return next(token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req);
};

@Injectable({ providedIn: 'root' })
export class UsersApi {
  private readonly http = inject(HttpClient);
  list() { return this.http.get<User[]>('/api/users'); }
}
```

- Services return `Observable`s; components either `toSignal` them or use `| async`. Subscribe manually only for imperative actions (submit), and clean up with `takeUntilDestroyed()`.
- `switchMap` for typeahead/search (cancel previous), `exhaustMap` for submit buttons, `mergeMap` when order does not matter, `concatMap` when it does. Never nest `subscribe`.
- Share expensive streams with `shareReplay({ bufferSize: 1, refCount: true })`.
- Errors: `catchError` at the service boundary returning typed results, a global `HttpInterceptorFn` for 401/5xx, and `ErrorHandler` provider for uncaught errors.

### SSR and hydration

- `ng add @angular/ssr` adds `server.ts` and `provideClientHydration()`; use `withEventReplay()` (18+) and `withIncrementalHydration()` + `@defer (hydrate on viewport)` (19+).
- Guard browser APIs with `isPlatformBrowser(inject(PLATFORM_ID))` or `afterNextRender()`. Avoid direct DOM manipulation; use `Renderer2` or signals.
- Keep rendered markup valid HTML (no `<div>` inside `<p>`, no mismatched tables) or hydration fails.

## Common tasks

### Generate and wire a component

1. `ng generate component features/users/user-list --change-detection=OnPush` (standalone by default in 17+ CLI; add `--standalone` on 17/18 if the schematic default is false).
2. Add `imports` for pipes/components used in the template; use signals for state.
3. Route it with `loadComponent`, or import it into the parent's `imports`.
4. Spec: `ng g c` creates `*.spec.ts`; adjust to `TestBed.configureTestingModule({ imports: [UserListComponent], providers: [...] })`.

### Add a service with HTTP

1. `ng generate service core/users-api`; inject `HttpClient`; return typed observables.
2. In the component: `readonly users = toSignal(this.api.list(), { initialValue: [] })` or `httpResource` if the project is on 20+ and already uses it.
3. Test with `provideHttpClient()` + `provideHttpClientTesting()` and `HttpTestingController`.

### Add a route with a guard

1. Add to `routes` with `loadComponent` and `canActivate: [guardFn]`.
2. Guard as `CanActivateFn` using `inject()`; return `boolean | UrlTree | Observable<boolean | UrlTree>`.
3. Bind params with `withComponentInputBinding()` and `input()` in the component.

### Build a form

1. `NonNullableFormBuilder.group` with validators; `ReactiveFormsModule` in `imports`.
2. Submit handler guards on `invalid`, calls the service with `exhaustMap` or a direct subscription, shows pending/disabled state via a signal.
3. Unit test: set values via `form.setValue`, assert `valid` and submitted payload.

### Write a component test

```ts
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { CounterComponent } from './counter.component';

it('increments', async () => {
  await render(CounterComponent, { inputs: { start: 1 } });
  await userEvent.click(screen.getByRole('button', { name: /increment/i }));
  expect(screen.getByText('Count: 2')).toBeInTheDocument();
});
```

Without Testing Library: `const fixture = TestBed.createComponent(CounterComponent); fixture.componentRef.setInput('start', 1); fixture.detectChanges();` then query `fixture.nativeElement`. With `OnPush`, call `fixture.detectChanges()` after changing inputs; with zoneless, `await fixture.whenStable()`. Provide HTTP with `provideHttpClient()` and `provideHttpClientTesting()`; routing with `provideRouter([])`.

### Upgrade Angular

1. Read https://angular.dev/update-guide for the exact from/to versions.
2. `ng update @angular/core@<major> @angular/cli@<major>` then other `@angular/*` and `angular-eslint`, Material/CDK.
3. Run the offered migrations (control flow, standalone, signal inputs) as separate commits.

## Pitfalls

- Calling `inject()` outside an injection context (in `ngOnInit`, event handlers, or after `await`); move it to a field initialiser or use `runInInjectionContext`.
- Writing to a signal that the same `effect` reads (infinite loop) or using `effect` to derive state that should be `computed`.
- Mutating arrays/objects held in signals (`items().push(x)`) and expecting updates; use `update(list => [...list, x])`.
- `@for` without `track`, or `track $index` on data that reorders (DOM reuse bugs).
- Subscribing in components without `takeUntilDestroyed`/`async` pipe (leaks), or nesting subscriptions instead of `switchMap`.
- Importing `CommonModule`/`FormsModule` everywhere instead of the specific pipe/directive; or forgetting to import a child component and getting an "unknown element" error.
- Using `any` from untyped `FormGroup` instead of `NonNullableFormBuilder`/typed controls.
- Running browser-only code (`window`, `localStorage`) in constructors when SSR is on.
- Functions with side effects or heavy work called from templates; they run on every change detection.
- Marking a component `OnPush` but mutating `@Input` objects in place upstream.
- Adding `zone.js` assumptions (e.g. relying on `setTimeout` triggering CD) in projects moving to zoneless.

## Verification

```bash
cat package.json | jq .scripts
ng lint                                   # angular-eslint (ng add angular-eslint if missing)
npx tsc -p tsconfig.app.json --noEmit     # fast type check; strictTemplates is enforced by ng build
ng test --watch=false                     # Karma/Jasmine or the configured unit-test builder
npx jest                                  # if jest-preset-angular is used instead
ng build                                  # production build with AOT and template type-checking
ng e2e                                    # only if an e2e builder is configured (Cypress/Playwright)
```

## References

- [references/signals.md](references/signals.md): signal APIs by version, RxJS interop, and decorator-to-signal migration.
- Angular docs: https://angular.dev
- Signals guide: https://angular.dev/guide/signals
- Control flow: https://angular.dev/guide/templates/control-flow
- Router: https://angular.dev/guide/routing
- Reactive forms: https://angular.dev/guide/forms/reactive-forms
- Update guide: https://angular.dev/update-guide
- Testing Library for Angular: https://testing-library.com/docs/angular-testing-library/intro
