---
name: zustand
description: Manage client state with Zustand 4/5 - creating stores with create/createStore, selectors (and useShallow) to avoid re-renders, the slices pattern, middleware (persist, devtools, immer, subscribeWithSelector), using the store outside React, per-component stores via context, and testing. Load when a project depends on zustand or when adding or refactoring global or shared client state in a React app.
---

# Zustand

Assumes Zustand 5 (React 18+). Zustand 4 is nearly identical; v5 dropped the default-export import, removed the deprecated `create(selector, equalityFn)` signature (use `useShallow` or `createWithEqualityFn` from `zustand/traditional`), and requires selectors to return stable references (an infinite loop error appears otherwise).

## When to use

- Shared client state across components (UI state, session, cart, editor state) without prop drilling or context re-render problems.
- Replacing `useContext` + `useReducer` boilerplate or a legacy Redux store in a small/medium app.
- Reading or updating state from non-React code (websocket handlers, API interceptors, routers).
- Persisting state to storage, debugging with Redux DevTools, or testing store logic.
- Server data belongs in TanStack Query/SWR/RTK Query; do not duplicate it in Zustand.

## Project conventions to detect first

1. Version in `package.json` (`^5` vs `^4`); import style must be `import { create } from 'zustand'`.
2. Store location and naming: `stores/useCartStore.ts`, `store/index.ts`, or colocated per feature. Hook named `useXStore`.
3. Middleware in use: `persist` (check `name`, `storage`, `partialize`, `version`/`migrate`), `devtools`, `immer`, `subscribeWithSelector`. Keep the same wrapping order.
4. Selector style: inline `useStore((s) => s.x)`, `useShallow`, or auto-generated selectors (`createSelectors` helper). Follow it.
5. Slices pattern: `StateCreator<Store, [], [], Slice>` types and a combining `create`.
6. SSR framework: Next.js App Router projects usually create stores per request with `createStore` + a context provider (to avoid sharing state between requests); check for `StoreProvider`.
7. Tests: `__mocks__/zustand.ts` that resets stores between tests (from the docs), or manual `useStore.setState(initialState, true)` in `afterEach`.

## Core guidance

### Creating a store

```ts
// stores/useCartStore.ts
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

interface CartItem { id: string; qty: number }
interface CartState {
  items: CartItem[];
  add: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  total: () => number;                       // derived via get(); or compute in a selector
}

export const useCartStore = create<CartState>()(
  devtools(
    persist(
      (set, get) => ({
        items: [],
        add: (id) =>
          set((s) => {
            const existing = s.items.find((i) => i.id === id);
            return {
              items: existing
                ? s.items.map((i) => (i.id === id ? { ...i, qty: i.qty + 1 } : i))
                : [...s.items, { id, qty: 1 }],
            };
          }, undefined, 'cart/add'),           // devtools action name
        remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) }), undefined, 'cart/remove'),
        clear: () => set({ items: [] }, undefined, 'cart/clear'),
        total: () => get().items.reduce((n, i) => n + i.qty, 0),
      }),
      { name: 'cart', partialize: (s) => ({ items: s.items }) },
    ),
  ),
);
```

- `create<State>()(...)` with the extra `()` (curried form) is required for TypeScript when using middleware.
- `set` merges one level by default; `set(state, true)` replaces. Nested objects must be spread manually (or use `immer` middleware).
- Keep actions inside the store (colocated) or as module-level functions that call `useStore.setState`; both are fine, be consistent. Actions are stable references, so selecting them never causes re-renders.
- Never put non-serializable, framework-bound values (DOM nodes, class instances with methods) in persisted stores.

### Selectors and re-renders

```ts
const items = useCartStore((s) => s.items);                 // re-renders only when items changes
const add = useCartStore((s) => s.add);                     // stable
const { a, b } = useCartStore(useShallow((s) => ({ a: s.a, b: s.b })));   // multiple fields
const ids = useCartStore(useShallow((s) => s.items.map((i) => i.id)));    // derived arrays
```

- `useStore()` with no selector subscribes to everything; avoid it outside tiny apps.
- Selectors that return new objects/arrays each call must be wrapped in `useShallow` (v4.4+/v5) or the component re-renders on every store change (and v5 throws "Maximum update depth exceeded" in some cases).
- Expensive derived data: compute in the selector with `useShallow`, memoize with `useMemo` on the selected inputs, or store it precomputed in an action.
- Auto-generated selectors helper (`useStore.use.items()`) is documented in the Zustand docs; use it only if the project already has it.

### Slices pattern

```ts
import { create, type StateCreator } from 'zustand';

interface FishSlice { fishes: number; addFish: () => void }
interface BearSlice { bears: number; eatFish: () => void }
type Store = FishSlice & BearSlice;

const createFishSlice: StateCreator<Store, [['zustand/devtools', never]], [], FishSlice> = (set) => ({
  fishes: 0,
  addFish: () => set((s) => ({ fishes: s.fishes + 1 })),
});
const createBearSlice: StateCreator<Store, [['zustand/devtools', never]], [], BearSlice> = (set) => ({
  bears: 0,
  eatFish: () => set((s) => ({ fishes: s.fishes - 1 })),   // slices can read/write each other
});

export const useBoundStore = create<Store>()(devtools((...a) => ({ ...createFishSlice(...a), ...createBearSlice(...a) })));
```

The second generic lists the middleware mutators applied by the combining `create` (`['zustand/devtools', never]`, `['zustand/persist', unknown]`, `['zustand/immer', never]`), in the same order.

### Middleware

- Order: `devtools(persist(immer(creator)))` is the common recommendation; `devtools` outermost so it sees all updates; `immer` innermost.
- `persist`: `name` must be unique per store; default storage is `localStorage` via `createJSONStorage(() => localStorage)`; use `createJSONStorage(() => sessionStorage)` or an async storage (AsyncStorage, IndexedDB wrapper). `partialize` to persist a subset; `version` + `migrate` when the shape changes; `skipHydration: true` plus `useStore.persist.rehydrate()` for manual control; `useStore.persist.onFinishHydration` or a `hasHydrated` flag to avoid SSR mismatch.
- `immer`: `set((s) => { s.items.push(item) })` mutates a draft; import from `zustand/middleware/immer` and install `immer`.
- `subscribeWithSelector`: enables `useStore.subscribe((s) => s.x, (x, prev) => ..., { fireImmediately: true })`.
- `devtools`: name the store (`{ name: 'cart' }`) and pass action names as the third `set` argument; `enabled: process.env.NODE_ENV !== 'production'`.

### Outside React

```ts
useCartStore.getState().clear();                                 // read/act
useCartStore.setState({ items: [] });                            // write
const unsub = useCartStore.subscribe((state, prev) => { ... });  // listen (whole state; use subscribeWithSelector for slices)
```

Use this in sockets, interceptors, route guards. `getState()` returns a snapshot; do not hold onto it across awaits.

### Vanilla stores and per-instance stores (SSR, lists)

```tsx
import { createStore, useStore } from 'zustand';
import { createContext, useContext, useRef } from 'react';

const makeCounterStore = (initial: number) => createStore<{ count: number; inc: () => void }>()((set) => ({ count: initial, inc: () => set((s) => ({ count: s.count + 1 })) }));
type CounterStore = ReturnType<typeof makeCounterStore>;
const CounterContext = createContext<CounterStore | null>(null);

export function CounterProvider({ initial, children }: { initial: number; children: React.ReactNode }) {
  const ref = useRef<CounterStore>(null);
  if (!ref.current) ref.current = makeCounterStore(initial);
  return <CounterContext.Provider value={ref.current}>{children}</CounterContext.Provider>;
}
export function useCounter<T>(selector: (s: { count: number; inc: () => void }) => T) {
  const store = useContext(CounterContext);
  if (!store) throw new Error('CounterProvider missing');
  return useStore(store, selector);
}
```

Required in Next.js App Router (a module-level store would be shared across requests on the server) and for repeated widgets that need isolated state.

### Testing

```ts
// stores/useCartStore.test.ts
import { useCartStore } from './useCartStore';
const initial = useCartStore.getInitialState();   // v4.5+/v5
afterEach(() => useCartStore.setState(initial, true));

it('adds items', () => {
  useCartStore.getState().add('a');
  expect(useCartStore.getState().items).toEqual([{ id: 'a', qty: 1 }]);
});
```

- Test actions through `getState()`; test components with Testing Library and set preconditions via `setState`.
- The docs provide a `__mocks__/zustand.ts` that tracks every store and resets all of them in `afterEach`; add it when many stores exist.
- Persisted stores in jsdom: clear `localStorage` between tests or mock the storage.

## Common tasks

### Create a store

1. `stores/use<Name>Store.ts` with a typed `interface`, `create<T>()(...)`, actions inside, devtools in dev.
2. Select narrowly in components; `useShallow` for multi-field selects.
3. Unit test actions; reset state in `afterEach`.

### Persist part of the state

Wrap with `persist(..., { name: 'settings', partialize: (s) => ({ theme: s.theme }), version: 2, migrate: (persisted, version) => ... })`. For SSR, guard initial render with a hydration flag.

### Migrate from Context + useReducer

1. Move the reducer cases into store actions.
2. Replace `useContext(Ctx)` consumers with narrow selectors; delete the provider unless per-instance state is needed.

### Reset the whole store

Capture `const initialState = { ... }` separately from actions and expose `reset: () => set(initialState)`; or `useStore.setState(useStore.getInitialState(), true)`.

## Pitfalls

- Selecting the whole store or a fresh object without `useShallow`; everything re-renders (or v5 throws).
- `set` with nested updates that drop sibling keys (`set({ user: { name } })` loses `user.email`); spread or use immer.
- Persist key collisions between stores (same `name`) or persisting functions/Dates (serialized to strings).
- Hydration mismatch in SSR because persisted client state differs from server-rendered defaults; render after hydration or use `skipHydration`.
- Module-level stores in Next.js App Router server components; create per-request stores with context.
- Calling `getState()` once and reading stale values later in async code; call it again after `await`.
- Storing server responses in Zustand and re-implementing caching; use a server-state library.
- `useStore.subscribe` with a selector but without `subscribeWithSelector` middleware (ignored signature in v4; type error in v5).
- Zustand 4 `create(selector, equalityFn)` second argument: removed in v5 (`createWithEqualityFn` from `zustand/traditional` if truly needed).
- Default import `import create from 'zustand'` (removed in v5).

## Verification

```bash
npx tsc --noEmit
npm run lint
npm test            # store unit tests + component tests
npm run build
```

With `devtools` enabled, open Redux DevTools and check that actions are named and state updates are minimal; use React DevTools Profiler to confirm selectors prevent unrelated re-renders.

## References

- Zustand docs: https://zustand.docs.pmnd.rs/
- TypeScript guide (curried create, slices typing): https://zustand.docs.pmnd.rs/guides/typescript
- Persist middleware: https://zustand.docs.pmnd.rs/integrations/persisting-store-data
- Next.js setup: https://zustand.docs.pmnd.rs/guides/nextjs
- Testing: https://zustand.docs.pmnd.rs/guides/testing
- v5 migration: https://zustand.docs.pmnd.rs/migrations/migrating-to-v5
