---
name: tanstack-query
description: Manage server state with TanStack Query v5 (React Query, also Vue/Svelte adapters) - query key design, queryOptions, useQuery/useMutation, invalidation, staleTime and gcTime caching, prefetching and SSR hydration, suspense queries, devtools, and testing. Load when a project depends on @tanstack/react-query, @tanstack/vue-query or @tanstack/svelte-query, or when fetching, caching or mutating server data in components.
---

# TanStack Query v5

Assumes `@tanstack/react-query` v5 (React 18+). Vue and Svelte adapters share the core concepts and option names; the hook names differ (`useQuery` in Vue, `createQuery` in Svelte v5 adapter). v4 differences: `cacheTime` renamed `gcTime`, `isLoading` renamed `isPending`, only the object signature is supported, `useErrorBoundary` renamed `throwOnError`.

## When to use

- Fetching, caching, refetching, or paginating server data in components.
- Creating, updating or deleting server data with mutations and keeping the cache consistent.
- Server-side rendering with prefetch + hydration (Next.js, Remix, TanStack Start).
- Optimistic updates, infinite scroll, polling, dependent queries, suspense.
- Testing components that use queries.

## Project conventions to detect first

1. Version in `package.json` (`^5` vs `^4`). Framework adapter (`react`, `vue`, `svelte`, `solid`).
2. `QueryClient` setup: where it is created (`app/providers.tsx`, `main.tsx`), its `defaultOptions` (`staleTime`, `retry`, `throwOnError`), and whether it is created per request on the server.
3. Key conventions: a `queryKeys` factory file (`lib/query-keys.ts`), `queryOptions()` helpers co-located with API functions (`features/todos/queries.ts`), or inline keys. Follow the existing factory.
4. Fetch layer: `fetch` wrapper, `axios` instance, `ky`, tRPC, or an OpenAPI-generated client. `queryFn` should call that layer, not raw `fetch`.
5. Devtools: `@tanstack/react-query-devtools` mounted in dev.
6. ESLint: `@tanstack/eslint-plugin-query` (`exhaustive-deps` for keys, `no-rest-destructuring`). Keep it enabled.
7. SSR pattern: `HydrationBoundary` + `dehydrate` (App Router), `useQuery` + `initialData`, or framework loaders (`queryClient.ensureQueryData` in Remix/TanStack Router loaders).
8. Persistence: `@tanstack/query-persist-client-core` / `persistQueryClient` with IndexedDB/localStorage.

## Core guidance

### QueryClient and provider

```tsx
// app/providers.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60 * 1000, retry: 1, refetchOnWindowFocus: false },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);  // one per app on the client
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
```

- Set a non-zero global `staleTime`; the default `0` refetches on every mount/focus and surprises people. `gcTime` (default 5 min) controls how long unused data stays in memory.
- On the server create a new client per request (or use a `cache()`d getter) to avoid leaking data between users.

### Query keys and queryOptions

```ts
// features/todos/queries.ts
import { queryOptions, infiniteQueryOptions } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const todoKeys = {
  all: ['todos'] as const,
  lists: () => [...todoKeys.all, 'list'] as const,
  list: (filters: TodoFilters) => [...todoKeys.lists(), filters] as const,
  detail: (id: string) => [...todoKeys.all, 'detail', id] as const,
};

export const todoListOptions = (filters: TodoFilters) =>
  queryOptions({
    queryKey: todoKeys.list(filters),
    queryFn: ({ signal }) => api.todos.list(filters, { signal }),
    staleTime: 30_000,
  });

export const todoDetailOptions = (id: string) =>
  queryOptions({ queryKey: todoKeys.detail(id), queryFn: ({ signal }) => api.todos.get(id, { signal }) });
```

- Keys are arrays, hierarchical from generic to specific, and include every variable the `queryFn` uses (the lint rule enforces it). Objects in keys are compared structurally, so key order inside an object does not matter.
- `queryOptions()` gives one typed definition reusable by `useQuery`, `useSuspenseQuery`, `prefetchQuery`, `ensureQueryData`, `getQueryData` (returns the right type) and `setQueryData`.
- Pass `signal` to the fetch call so unmounted/superseded queries abort.
- Throw on non-2xx responses in the fetch layer; `fetch` does not reject on HTTP errors, and Query only sees errors that are thrown.

### Reading data

```tsx
const { data, isPending, isError, error, refetch, isFetching } = useQuery(todoListOptions(filters));
if (isPending) return <Spinner />;
if (isError) return <ErrorMessage error={error} />;
return <List items={data} />;
```

- `isPending`: no data yet. `isFetching`: a request is in flight (including background refetch). Show skeletons for `isPending`, subtle indicators for `isFetching`.
- Dependent queries: `enabled: !!userId`; or `skipToken` in place of `queryFn` to keep types strict (`queryFn: userId ? () => fetchUser(userId) : skipToken`).
- `select: (data) => data.items.length` derives/trims data without extra renders; keep it referentially stable (define outside or `useCallback`).
- `placeholderData: keepPreviousData` for paginated tables so the old page stays while the new one loads.
- `useQueries({ queries: ids.map(todoDetailOptions) })` for dynamic parallel queries; `combine` to merge results.
- Infinite lists: `useInfiniteQuery({ ...infiniteQueryOptions, initialPageParam: 0, getNextPageParam: (last) => last.nextCursor ?? undefined })` then `fetchNextPage`, `hasNextPage`.
- Polling: `refetchInterval: 5000` (or a function of the data to stop when finished).

### Mutations and invalidation

```tsx
const queryClient = useQueryClient();
const addTodo = useMutation({
  mutationFn: (input: NewTodo) => api.todos.create(input),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: todoKeys.lists() }),
  onError: (err) => toast.error(err.message),
});

<button disabled={addTodo.isPending} onClick={() => addTodo.mutate({ title })}>Add</button>
```

- Invalidate the broadest reasonable key after a mutation (`todoKeys.all` or `lists()`); matching is prefix-based. Return the promise from `onSuccess` (`return queryClient.invalidateQueries(...)`) to keep `isPending` true until refetch finishes.
- `mutateAsync` only when you need the result inline and will `try/catch` it; `mutate` with callbacks otherwise.
- Optimistic updates, cache-based:

```ts
onMutate: async (newTodo) => {
  await queryClient.cancelQueries({ queryKey: todoKeys.lists() });
  const previous = queryClient.getQueryData(todoListOptions(filters).queryKey);
  queryClient.setQueryData(todoListOptions(filters).queryKey, (old) => old ? [...old, { ...newTodo, id: 'tmp' }] : old);
  return { previous };
},
onError: (_e, _v, ctx) => ctx?.previous && queryClient.setQueryData(todoListOptions(filters).queryKey, ctx.previous),
onSettled: () => queryClient.invalidateQueries({ queryKey: todoKeys.lists() }),
```

Simpler UI-only optimism: render `addTodo.variables` while `addTodo.isPending`.

- Use `useMutationState` to read pending mutations from other components; `mutationKey` + `scope: { id }` serializes related mutations.

### SSR and hydration (Next.js App Router)

```tsx
// app/todos/page.tsx (server component)
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
export default async function Page() {
  const queryClient = getQueryClient();             // per-request client
  await queryClient.prefetchQuery(todoListOptions({}));
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Todos />                                      {/* client component calls useQuery(todoListOptions({})) */}
    </HydrationBoundary>
  );
}
```

- Set `staleTime > 0` on the server client so hydrated data is not immediately refetched on the client.
- Streaming with `useSuspenseQuery` on the client plus `@tanstack/react-query-next-experimental` (`ReactQueryStreamedHydration`) is optional; check the project before adding it.
- Router loaders (TanStack Router, Remix, React Router): `loader: ({ context }) => context.queryClient.ensureQueryData(todoListOptions())`, then `useSuspenseQuery` in the component.

### Suspense and errors

- `useSuspenseQuery(options)`: `data` is always defined; wrap in `<Suspense>` and an error boundary. Do not use `enabled` with it; use `skipToken` patterns or conditional rendering instead.
- `throwOnError: (error) => error.status >= 500` to send server errors to boundaries while rendering 4xx inline.
- Reset boundaries with `QueryErrorResetBoundary` or `useQueryErrorResetBoundary` so retry buttons work.

### Devtools

Mount `<ReactQueryDevtools />` under the provider in development. Use it to inspect keys, staleness, observers, and to trigger refetch/invalidate while debugging. For production debugging the devtools can be lazy-loaded behind a flag.

## Common tasks

### Add a new resource

1. API function(s) in the fetch layer with typed responses and `signal`.
2. Key factory entries and `queryOptions` helpers in `features/<resource>/queries.ts`.
3. `useQuery(...)` in the component; mutation hooks with invalidation.
4. Prefetch in route loaders / server components if the route needs the data on first paint.
5. Test with msw handlers.

### Paginated table

`useQuery({ ...listOptions({ page }), placeholderData: keepPreviousData })`; prefetch the next page with `queryClient.prefetchQuery(listOptions({ page: page + 1 }))` in an effect when `hasMore`.

### Update the cache after a detail mutation

`queryClient.setQueryData(todoKeys.detail(id), updated)` for the detail, then `invalidateQueries({ queryKey: todoKeys.lists() })` for lists.

### Test a component

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

it('lists todos', async () => {
  server.use(http.get('/api/todos', () => HttpResponse.json([{ id: '1', title: 'a' }])));   // msw
  renderWithClient(<Todos />);
  expect(await screen.findByText('a')).toBeInTheDocument();
});
```

Fresh client per test, `retry: false`, `gcTime: Infinity` if jest fake timers complain. Mock the network with msw, not `useQuery`.

## Pitfalls

- Variables missing from the key: stale data shown for different arguments.
- `staleTime: 0` globally plus `refetchOnWindowFocus` producing surprising request storms.
- Fetch layer that resolves on 404/500; Query treats it as success.
- `useQuery` inside a loop or conditionally (Rules of Hooks); use `useQueries`.
- Copying query data into `useState` and editing it; derive with `select` or keep form state separate and write back via mutation.
- Invalidating with the wrong specificity (`['todos', id]` when the list key is `['todos', 'list', ...]`).
- Sharing one `QueryClient` across SSR requests (data leaks between users).
- Awaiting `mutateAsync` without `try/catch` causing unhandled rejections.
- `select` returning a new object every render with an unstable function; memoize.
- Treating Query as a client-state store; use zustand/context for UI state.
- `useSuspenseQuery` with `enabled: false` (unsupported) or without an error boundary.
- v4-era options (`cacheTime`, `isLoading` meaning "no data", `onSuccess` on `useQuery`): removed or changed in v5.

## Verification

```bash
npm run lint                     # @tanstack/eslint-plugin-query rules
npx tsc --noEmit                 # queryOptions typing catches key/fn mismatches
npm test                         # vitest/jest + testing-library + msw
npm run build
```

Open the devtools panel and confirm keys, staleness and observer counts match expectations on the affected screens.

## References

- TanStack Query docs: https://tanstack.com/query/latest/docs/framework/react/overview
- v5 migration guide: https://tanstack.com/query/latest/docs/framework/react/guides/migrating-to-v5
- Query keys guide: https://tanstack.com/query/latest/docs/framework/react/guides/query-keys
- SSR and hydration: https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr
- Testing: https://tanstack.com/query/latest/docs/framework/react/guides/testing
- Practical React Query (TkDodo): https://tkdodo.eu/blog/practical-react-query
