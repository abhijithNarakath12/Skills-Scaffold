---
name: redux-toolkit
description: Manage global client state with Redux Toolkit 2 and React Redux 9 - configureStore, createSlice with Immer, createAsyncThunk vs RTK Query for server data, typed hooks (useAppSelector/useAppDispatch), memoized selectors with reselect, listener middleware, and testing. Load when a project depends on @reduxjs/toolkit, redux or react-redux, or when working with slices, reducers, actions, thunks or RTK Query endpoints.
---

# Redux Toolkit 2

Assumes `@reduxjs/toolkit` 2.x, `react-redux` 9.x, TypeScript. Legacy patterns (`createStore`, hand-written action types/constants, `connect()`, `switch` reducers) appear only in old code; do not add new ones. RTK 2 removed the object syntax for `createReducer`/`extraReducers` (use the builder callback) and requires ES2020 targets.

## When to use

- Adding or changing slices, reducers, actions, thunks, or store configuration.
- Fetching/caching server data via RTK Query or deciding between RTK Query and thunks.
- Writing selectors, fixing re-render performance, or typing hooks and state.
- Testing reducers, thunks, components connected to the store.

## Project conventions to detect first

1. Versions: `@reduxjs/toolkit` (1.x vs 2.x), `react-redux` (8 vs 9), `redux-persist`, `redux-saga`/`redux-observable` (legacy side-effect libraries; do not add thunks alongside sagas without agreement).
2. Store file: `app/store.ts` or `store/index.ts` exporting `store`, `RootState`, `AppDispatch`, and typed hooks (`useAppDispatch`, `useAppSelector`) in `app/hooks.ts`. Reuse them; never use untyped `useSelector`.
3. Folder layout: feature folders (`features/todos/todosSlice.ts`, `features/api/apiSlice.ts`) vs ducks. Follow it.
4. Server data: RTK Query (`createApi` with `fetchBaseQuery` or `graphqlRequestBaseQuery`), `createAsyncThunk`, or an external library (TanStack Query, SWR). Do not introduce a second approach.
5. Selector conventions: colocated in the slice file, `createSelector` from RTK (re-exported reselect), `createEntityAdapter` selectors.
6. Dev tooling: Redux DevTools enabled by `configureStore` in dev; serializability/immutability middleware config.
7. Persistence: `redux-persist` with `PersistGate`, or RTK Query cache persistence patterns.

## Core guidance

### Store setup

```ts
// app/store.ts
import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import todosReducer from '@/features/todos/todosSlice';
import { api } from '@/features/api/apiSlice';

export const store = configureStore({
  reducer: { todos: todosReducer, [api.reducerPath]: api.reducer },
  middleware: (getDefault) => getDefault().concat(api.middleware),
});
setupListeners(store.dispatch);        // refetchOnFocus/refetchOnReconnect for RTK Query

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export type AppStore = typeof store;
```

```ts
// app/hooks.ts
import { useDispatch, useSelector, useStore } from 'react-redux';
import type { RootState, AppDispatch, AppStore } from './store';
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();   // react-redux 9.1+
export const useAppSelector = useSelector.withTypes<RootState>();
export const useAppStore = useStore.withTypes<AppStore>();
```

- `configureStore` includes thunk, DevTools, and dev-only immutability/serializability checks. Keep the checks on; fix the non-serializable value (Date, class instance, Promise) rather than ignoring the action, except for well-known cases (`redux-persist` actions via `ignoredActions`).
- For SSR or tests export a `makeStore(preloadedState?)` factory instead of a singleton.
- `combineSlices(todosSlice, api)` (RTK 2) builds the root reducer and supports lazy-loaded slices via `.withLazyLoadedSlices<>()` and `slice.injectInto(rootReducer)`.

### Slices

```ts
// features/todos/todosSlice.ts
import { createSlice, createEntityAdapter, nanoid, type PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';

interface Todo { id: string; title: string; done: boolean }
const adapter = createEntityAdapter<Todo>({ sortComparer: (a, b) => a.title.localeCompare(b.title) });

const todosSlice = createSlice({
  name: 'todos',
  initialState: adapter.getInitialState({ filter: 'all' as 'all' | 'open' }),
  reducers: {
    todoAdded: {
      reducer: adapter.addOne,
      prepare: (title: string) => ({ payload: { id: nanoid(), title, done: false } }),
    },
    todoToggled(state, action: PayloadAction<string>) {
      const todo = state.entities[action.payload];
      if (todo) todo.done = !todo.done;             // Immer: "mutation" produces a new state
    },
    filterChanged(state, action: PayloadAction<'all' | 'open'>) {
      state.filter = action.payload;
    },
  },
  selectors: {                                      // RTK 2: colocated selectors
    selectFilter: (state) => state.filter,
  },
});

export const { todoAdded, todoToggled, filterChanged } = todosSlice.actions;
export const { selectFilter } = todosSlice.selectors;
export const todosSelectors = adapter.getSelectors<RootState>((s) => s.todos);
export default todosSlice.reducer;
```

- Reducers must be pure: no side effects, no non-deterministic values (generate ids/dates in `prepare` or in the thunk/component).
- Immer rules: either mutate the draft or return a new value, never both. Replacing the whole state requires `return newState`. Do not reassign `state = ...`.
- Name actions as past-tense events (`todoAdded`), not setters (`setTodos`); model state by domain, not by component.
- Keep normalized collections with `createEntityAdapter` (`ids` + `entities`); avoid nested arrays of objects that require deep searches to update.
- Reacting to other slices' actions: `extraReducers: (builder) => builder.addCase(userLoggedOut, () => initialState)`. Use `addMatcher`/`isAnyOf` for groups.
- `createSlice.reducers` with the creator callback (`reducers: (create) => ({ ... create.asyncThunk(...) })`) needs `buildCreateSlice({ creators: { asyncThunk: asyncThunkCreator } })`; only use it if the project already does.

### Server data: RTK Query vs createAsyncThunk

Prefer RTK Query for anything fetched from an API: caching, deduplication, loading states, invalidation, polling, and generated hooks come for free. Use `createAsyncThunk` for one-off async logic that updates slice state (e.g. reading from IndexedDB, orchestrating multiple calls) or when the project standardised on thunks.

```ts
// features/api/apiSlice.ts
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: '/api',
    prepareHeaders: (headers, { getState }) => {
      const token = (getState() as RootState).auth.token;
      if (token) headers.set('authorization', `Bearer ${token}`);
      return headers;
    },
  }),
  tagTypes: ['Todo'],
  endpoints: (build) => ({
    getTodos: build.query<Todo[], void>({
      query: () => 'todos',
      providesTags: (result) => result ? [...result.map((t) => ({ type: 'Todo' as const, id: t.id })), { type: 'Todo', id: 'LIST' }] : [{ type: 'Todo', id: 'LIST' }],
    }),
    addTodo: build.mutation<Todo, Partial<Todo>>({
      query: (body) => ({ url: 'todos', method: 'POST', body }),
      invalidatesTags: [{ type: 'Todo', id: 'LIST' }],
    }),
  }),
});
export const { useGetTodosQuery, useAddTodoMutation } = api;
```

- Component usage: `const { data = [], isLoading, isFetching, error } = useGetTodosQuery(undefined, { pollingInterval: 30_000 })`; `const [addTodo, { isLoading: isAdding }] = useAddTodoMutation()`; `await addTodo(body).unwrap()` to get thrown errors.
- Split endpoints across files with `api.injectEndpoints({ endpoints })`; one `createApi` per base URL.
- Optimistic updates: `onQueryStarted` with `dispatch(api.util.updateQueryData('getTodos', undefined, (draft) => { ... }))` and `patchResult.undo()` on failure.
- `transformResponse` to normalise payloads; `keepUnusedDataFor` (seconds, default 60) for cache retention; `selectFromResult` to subscribe to a slice of the result.
- Codegen: `@rtk-query/codegen-openapi` generates endpoints from an OpenAPI spec.

```ts
// createAsyncThunk when needed
export const fetchUser = createAsyncThunk<User, string, { state: RootState; rejectValue: string }>(
  'user/fetch',
  async (id, { rejectWithValue, signal }) => {
    const res = await fetch(`/api/users/${id}`, { signal });
    if (!res.ok) return rejectWithValue(await res.text());
    return (await res.json()) as User;
  },
  { condition: (id, { getState }) => !getState().user.entities[id] },
);
// in extraReducers: builder.addCase(fetchUser.pending, ...).addCase(fetchUser.fulfilled, ...).addCase(fetchUser.rejected, (s, a) => { s.error = a.payload ?? a.error.message })
```

### Selectors and re-renders

- `useAppSelector` re-renders the component whenever the selected value changes by reference. Select the smallest value you need (`selectTodoById(state, id)`), not whole slices.
- Never return a fresh array/object from a plain selector (`state.todos.filter(...)`); use `createSelector` so the result is memoized, or `useAppSelector(selector, shallowEqual)` for small objects.

```ts
export const selectVisibleTodos = createSelector(
  [todosSelectors.selectAll, selectFilter],
  (todos, filter) => (filter === 'open' ? todos.filter((t) => !t.done) : todos),
);
```

- Parameterised selectors: `createSelector([selectAll, (_s: RootState, id: string) => id], ...)` and call `useAppSelector((s) => selectX(s, id))`. Reselect 5 (RTK 2) memoizes with `weakMapMemoize` by default so multiple arguments work without one-cache-per-instance hacks.
- Reselect 5 (RTK 2) dev-mode checks (`inputStabilityCheck`, `identityFunctionCheck`) log a warning when an input selector returns a new reference for the same state or the result function is an identity; fix the selector rather than disabling the check.
- Lists: have the parent select `ids` and each row select its own entity by id.

### Side effects outside components

- `createListenerMiddleware` (RTK 1.8+) for "when X happens, do Y" logic (analytics, debounced saves, cascading dispatches): `listenerMiddleware.startListening({ actionCreator: todoAdded, effect: async (action, api) => { ... } })`. Add it with `getDefault().prepend(listenerMiddleware.middleware)`.
- Access the store outside React via the exported `store` only in app-level modules (sockets, interceptors); inject it rather than importing it in reusable code to avoid circular imports.

### Testing

```ts
// reducer
expect(todosReducer(undefined, todoAdded('a')).ids).toHaveLength(1);

// component with a real store
import { Provider } from 'react-redux';
function renderWithStore(ui: React.ReactElement, preloaded?: Partial<RootState>) {
  const store = makeStore(preloaded);
  return { store, ...render(<Provider store={store}>{ui}</Provider>) };
}
```

- Test reducers as pure functions; test thunks/RTK Query through a real store with `msw` mocking the network; avoid asserting on dispatched action lists.
- Reset the RTK Query cache between tests: `store.dispatch(api.util.resetApiState())` or a fresh store per test.

## Common tasks

### Add a slice

1. `features/<name>/<name>Slice.ts` with `createSlice`, exported actions, selectors, default reducer export.
2. Register in `configureStore` (`reducer: { [name]: reducer }`) or `combineSlices`.
3. Use `useAppSelector`/`useAppDispatch` in components; add reducer tests.

### Add an API endpoint (RTK Query)

1. Add to `endpoints` (or `injectEndpoints`) with `query`, `providesTags`/`invalidatesTags`.
2. Export the generated hook; use it in the component; handle `isLoading`/`error`.
3. If the mutation affects a list, invalidate the `LIST` tag; if the server returns the updated entity, consider `updateQueryData` instead of a refetch.

### Migrate legacy Redux to RTK

1. Replace `createStore` + `applyMiddleware` with `configureStore`.
2. Convert each reducer/action-type pair to `createSlice`; keep action type strings stable (`name/reducerName`) only if other code depends on them.
3. Replace `connect` with hooks; replace hand-rolled fetch thunks with RTK Query incrementally.

### Reset state on logout

`extraReducers: (b) => b.addCase(loggedOut, () => initialState)` in each slice, plus `dispatch(api.util.resetApiState())`.

## Pitfalls

- Untyped `useSelector`/`useDispatch`; `dispatch(thunk())` fails to type-check without `AppDispatch`.
- Selectors returning new references each call; whole lists re-render on every store update.
- Putting server cache data in hand-written slices while RTK Query is available (duplicate loading/error logic).
- Non-serializable values in state or actions (Dates, Maps, class instances, functions); store ISO strings/ids.
- Mutating state outside reducers (in selectors or components) via references obtained from the store; the immutability check throws in dev.
- Both mutating the draft and returning a value in one reducer.
- Forgetting `api.middleware` in `configureStore` (RTK Query hooks silently never fetch and warn in dev).
- Dispatching thunks from reducers or reducers reading other slices (use selectors in thunks/listeners instead).
- Giant single slice; split by domain and compose with `combineSlices`.
- `createAsyncThunk` without `rejectWithValue`; `action.error` is a `SerializedError`, not your API payload.
- Storing derived data (filtered lists, totals) in state instead of selecting it.

## Verification

```bash
npx tsc --noEmit        # RootState/AppDispatch typing
npm run lint
npm test                # reducer unit tests, store-integrated component tests with msw
npm run build
```

Open Redux DevTools in the browser: confirm action names are descriptive, state is serializable, and no unexpected cascades of actions occur.

## References

- Redux Toolkit docs: https://redux-toolkit.js.org/
- Redux Style Guide: https://redux.js.org/style-guide/
- Usage with TypeScript: https://redux-toolkit.js.org/usage/usage-with-typescript
- RTK Query overview: https://redux-toolkit.js.org/rtk-query/overview
- RTK 2.0 migration: https://redux-toolkit.js.org/usage/migrating-rtk-2
- Reselect: https://reselect.js.org/
