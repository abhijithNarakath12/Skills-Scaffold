---
name: axios-fetch
description: Make HTTP requests correctly in JavaScript/TypeScript - native fetch vs axios (and ky/got), shared client instances with interceptors or hooks, timeouts and cancellation with AbortSignal, retries with backoff, error normalization, typed responses validated at the boundary, auth token refresh, and testing with msw. Load when a project depends on axios, ky or got, or when writing or debugging API calls, HTTP clients, interceptors, or request error handling.
---

# HTTP clients: fetch, axios, ky, got

Assumes native `fetch` (browsers, Node 18+, Deno, Bun, edge runtimes), axios 1.x, ky 1.x (fetch wrapper for browser/Node), got 13/14 (Node-only, ESM). Pick one client per codebase and route every request through a shared instance.

## When to use

- Adding or refactoring API calls, API client modules, or SDK wrappers.
- Handling auth headers and token refresh, timeouts, cancellation, retries, or consistent error objects.
- Typing and validating responses; uploading files; streaming downloads; proxies/agents in Node.
- Mocking HTTP in tests.
- Data-fetching libraries (TanStack Query, SWR, RTK Query) sit on top of these clients; this skill covers the transport layer.

## Project conventions to detect first

1. Which client: `axios` (and `axios-retry`), `ky`, `got`, `node-fetch`/`undici` (Node < 18 or advanced features), or plain `fetch`. Do not introduce a second one.
2. The shared instance: `lib/api.ts`, `services/http.ts`, `api/client.ts` with `baseURL`, default headers, interceptors/hooks. Add endpoints as functions there (`api.users.get(id)`), not inline `fetch` calls in components.
3. Error shape convention: a custom `ApiError` class, `{ status, code, message, details }` normalisation, or axios `AxiosError` used directly. Follow it.
4. Auth: `Authorization: Bearer` from a store/cookie, refresh-token interceptor with request queueing, `credentials: 'include'`/`withCredentials` for cookies, CSRF header.
5. Response typing: generated client (`openapi-typescript` + `openapi-fetch`, `orval`, `hey-api`), zod schemas per endpoint, or `as T` casts (weakest).
6. Runtime constraints: edge/serverless (no Node agents, fetch only), React Native (fetch/axios, no got), Node proxies (`https-proxy-agent`, `undici.ProxyAgent`).
7. Tests: `msw` (`setupServer`/`setupWorker`), `nock` (Node, got/axios), `vi.fn()` on the instance.

## Core guidance

### Choosing

- `fetch`: zero dependency, runs everywhere, streaming, `AbortSignal`. Lacks timeouts (use `AbortSignal.timeout`), does not throw on HTTP errors, no interceptors, verbose JSON handling.
- `ky`: tiny wrapper over fetch with retries, timeouts, hooks (`beforeRequest`, `afterResponse`, `beforeRetry`, `beforeError`), throws `HTTPError` on non-2xx, `.json<T>()` shortcut, `prefixUrl`, `searchParams`. Best modern default for browser/edge/Node 18+.
- `axios`: interceptors, automatic JSON, `baseURL`, upload/download progress, works in old browsers and Node (adapters), huge ecosystem. Use when already present or when progress events/XHR-specific behaviour are needed. Axios 1.x has a `fetch` adapter too (`adapter: 'fetch'`).
- `got`: Node-only, HTTP/2, pagination helpers, hooks, retries, streams, cache; use in Node CLIs/services already using it. Not for browsers/edge.

### Shared instance

fetch/ky style:

```ts
// lib/api.ts
import ky, { HTTPError } from 'ky';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); this.name = 'ApiError'; }
}

export const api = ky.create({
  prefixUrl: import.meta.env.VITE_API_URL,
  timeout: 10_000,
  retry: { limit: 2, methods: ['get', 'put', 'delete'], statusCodes: [408, 429, 500, 502, 503, 504] },
  hooks: {
    beforeRequest: [(req) => { const t = getToken(); if (t) req.headers.set('Authorization', `Bearer ${t}`); }],
    afterResponse: [
      async (req, opts, res) => {
        if (res.status === 401 && !req.headers.has('x-retried')) {
          const token = await refreshToken();                     // dedupe concurrent refreshes inside refreshToken()
          req.headers.set('Authorization', `Bearer ${token}`);
          req.headers.set('x-retried', '1');
          return ky(req, opts);
        }
      },
    ],
    beforeError: [
      async (error) => {
        const body = await error.response.json().catch(() => undefined) as { code?: string; message?: string } | undefined;
        return Object.assign(new ApiError(error.response.status, body?.code ?? 'http_error', body?.message ?? error.message, body), { cause: error });
      },
    ],
  },
});

export const users = {
  get: (id: string, signal?: AbortSignal) => api.get(`users/${id}`, { signal }).json().then(userSchema.parse),
  create: (input: NewUser) => api.post('users', { json: input }).json().then(userSchema.parse),
};
```

axios style:

```ts
// lib/api.ts
import axios, { AxiosError, isAxiosError } from 'axios';

export const api = axios.create({ baseURL: process.env.NEXT_PUBLIC_API_URL, timeout: 10_000, withCredentials: true });

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

let refreshing: Promise<string> | null = null;
api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError<{ code?: string; message?: string }>) => {
    const original = error.config!;
    if (error.response?.status === 401 && !(original as any)._retry) {
      (original as any)._retry = true;
      refreshing ??= refreshToken().finally(() => { refreshing = null; });
      const token = await refreshing;
      original.headers.set('Authorization', `Bearer ${token}`);
      return api(original);
    }
    throw new ApiError(error.response?.status ?? 0, error.response?.data?.code ?? (error.code ?? 'network_error'), error.response?.data?.message ?? error.message, error.response?.data);
  },
);

export const getUser = (id: string, signal?: AbortSignal) => api.get<unknown>(`/users/${id}`, { signal }).then((r) => userSchema.parse(r.data));
```

- One instance per API base URL; endpoint functions take typed inputs and return validated typed outputs; components/hooks never see raw `Response`/`AxiosResponse`.
- Keep auth token reads in the request hook (fresh per request), never captured at module load.
- Dedupe concurrent token refreshes (single in-flight promise) and mark retried requests to avoid loops.

### Plain fetch done right

```ts
export async function request<T>(path: string, schema: z.ZodType<T>, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 10_000, signal, ...rest } = init;
  const res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers: { accept: 'application/json', ...(rest.body ? { 'content-type': 'application/json' } : {}), ...rest.headers },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    throw new ApiError(res.status, body?.code ?? 'http_error', body?.message ?? res.statusText, body);
  }
  if (res.status === 204) return undefined as T;
  return schema.parse(await res.json());
}
```

- `fetch` rejects only on network failure/abort; always check `res.ok`.
- Serialize bodies yourself (`JSON.stringify`) and set `content-type`; for `FormData` do not set `content-type` (the boundary is added automatically).
- `AbortSignal.timeout(ms)` (Node 17.3+/modern browsers) for timeouts; `AbortSignal.any([...])` (Node 20+/modern browsers) to combine with a caller signal; otherwise create an `AbortController` and clear its timer in `finally`.
- Query strings: `new URLSearchParams(params)`; drop `undefined` values first.
- Streaming: `res.body` is a `ReadableStream`; for SSE use `EventSource` or parse the stream; for large downloads in Node pipe `Readable.fromWeb(res.body)`.
- Node: `fetch` is undici; set a global dispatcher (`setGlobalDispatcher(new ProxyAgent(url))`) for proxies, `keepAlive` is on by default. Timeouts for headers/body: `undici.Agent({ headersTimeout, bodyTimeout })`.

### Cancellation

- Accept an optional `signal` in every endpoint function and pass it through (`fetch`/`ky`/`axios` all accept `signal`; axios `CancelToken` is deprecated).
- In React effects create an `AbortController`, pass `controller.signal`, and `controller.abort()` in cleanup; TanStack Query provides `signal` in `queryFn`.
- Treat `AbortError`/`axios.isCancel(err)`/`err.name === 'TimeoutError'` as non-errors in UI (do not toast).

### Retries

- Retry only idempotent requests (GET, PUT, DELETE, HEAD) and only on network errors, 408, 425, 429, 5xx. Never retry POST blindly unless the API supports idempotency keys (send `Idempotency-Key` and then retrying is safe).
- Exponential backoff with jitter (ky and got do this by default; honour `Retry-After` on 429/503). For axios use `axios-retry` with `retryCondition: axiosRetry.isNetworkOrIdempotentRequestError` and `retryDelay: axiosRetry.exponentialDelay`.
- Cap total time (timeout per attempt plus attempt count) and surface the final error.

### Error normalization

- One `ApiError` type with `status` (0 for network), `code` (machine-readable, from the API when available), `message` (safe for logs; map to user text in the UI), `details` (validation errors), and `cause`.
- Distinguish: network/CORS failure (`TypeError: Failed to fetch`, axios `ERR_NETWORK`), timeout/abort, HTTP 4xx (client; show message, do not retry), 401 (refresh/logout), 403, 404, 409/422 (validation; map `details` to fields), 5xx (retry/generic message).
- Narrow in catch blocks: `if (err instanceof ApiError)`, `isAxiosError(err)`, `err instanceof HTTPError`; never read `err.response.data` without the guard.
- Log request id headers (`x-request-id`) with errors to correlate with server logs.

### Typed responses

- The response type is a claim about the server; validate it (zod/valibot) at the client boundary, or use a generated client from the OpenAPI spec (`openapi-fetch` gives typed paths, params and responses from `openapi-typescript` output). Avoid `axios.get<User>()` alone: the generic is a cast.
- Generated clients should still wrap the shared instance/hook pipeline for auth and errors.
- Dates arrive as strings; convert at the boundary (`z.coerce.date()`), not throughout the app.

### Uploads and special cases

- Files: `const fd = new FormData(); fd.append('file', file)`; `fetch(url, { method: 'POST', body: fd })` (no manual content-type). Progress: axios `onUploadProgress`, or `XMLHttpRequest`; fetch has no upload progress in most browsers.
- Large JSON/binary downloads: `res.arrayBuffer()`/`res.blob()`; set `responseType: 'blob' | 'arraybuffer' | 'stream'` in axios.
- Cookies cross-origin: `credentials: 'include'` (fetch/ky) or `withCredentials: true` (axios), server must send `Access-Control-Allow-Credentials` and an explicit origin.
- Server-side (Next.js/RSC, Node): pass through auth headers explicitly; `fetch` in Next.js has caching semantics (`cache`, `next: { revalidate }`); use `cache: 'no-store'` for user-specific data.

### Testing with msw

```ts
// test/server.ts
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
export const server = setupServer(
  http.get('*/users/:id', ({ params }) => HttpResponse.json({ id: params.id, email: 'a@b.co' })),
);
// setupTests.ts: beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterEach(() => server.resetHandlers()); afterAll(() => server.close());

it('maps 422 to ApiError with details', async () => {
  server.use(http.post('*/users', () => HttpResponse.json({ code: 'validation', message: 'Invalid', details: { email: ['taken'] } }, { status: 422 })));
  await expect(users.create({ email: 'x' })).rejects.toMatchObject({ status: 422, code: 'validation' });
});
```

- msw intercepts fetch, XHR (axios default adapter), ky, and Node `http` (got, axios Node adapter) via `msw/node`; one mocking approach for all clients.
- `onUnhandledRequest: 'error'` catches unexpected calls. Test retries by returning 503 once then 200 (`HttpResponse.json(..., { status: 503 })` with a counter).
- Browser E2E (Playwright) can use `page.route` or `msw/browser`.
- Do not mock the client module (`vi.mock('axios')`) in integration-style tests; it hides interceptor and serialization bugs.

## Common tasks

### Add an endpoint

1. Define the response schema/type (or regenerate the OpenAPI client).
2. Add `resource.action(args, signal?)` to the API module using the shared instance; parse the response.
3. Use it from a query/mutation hook or service; handle `ApiError` by `status`/`code`.
4. msw handler + test for success and one failure path.

### Add auth with refresh

Request hook adds the bearer token; response hook on 401 performs a single deduped refresh, retries the original once, and logs out on failure. Exclude the refresh endpoint itself from the interceptor.

### Add timeouts and cancellation to existing fetch calls

Replace raw `fetch` with the `request()` helper above; thread `signal` from callers (effects, query functions).

### Migrate axios to fetch/ky

Keep the `ApiError` shape and endpoint function signatures; swap the instance; move request/response interceptors to `beforeRequest`/`afterResponse` hooks; replace `response.data` with `.json()`; replace `isAxiosError` guards with `instanceof HTTPError`/`ApiError`.

## Pitfalls

- Checking only for thrown errors with `fetch`; 4xx/5xx resolve successfully.
- Setting `content-type: multipart/form-data` manually (breaks the boundary).
- Module-level token capture (`headers: { Authorization: token }` at create time) that never refreshes.
- Infinite refresh loops on 401 (no `_retry` marker) or many parallel refreshes (no shared promise).
- Retrying non-idempotent POSTs; duplicate orders/payments.
- Swallowing `AbortError` as a real failure (error toasts on navigation) or, conversely, not aborting stale requests (race conditions rendering old data).
- `axios.get<T>` or `as T` casts without validation; runtime shape drift goes unnoticed.
- CORS misdiagnosed as a client bug; the server must send the right headers and the client must send `credentials` consistently.
- `JSON.parse` on empty 204/205 bodies; check status/`content-length` first.
- Node: `got` or `https` agents imported in code bundled for the browser/edge; axios `httpAgent` options ignored under the fetch adapter.
- `timeout` on axios covers only the response start, not the body download; use `signal` for total time.
- Logging full request/response bodies with secrets; redact `Authorization`, `Set-Cookie`.

## Verification

```bash
npx tsc --noEmit
npm run lint
npm test              # msw-backed tests for success, 4xx mapping, 401 refresh, retry, abort
npm run build         # catches Node-only imports in browser bundles
```

Check the browser Network panel: one request per action (no duplicates), aborted requests on navigation, correct headers, no secrets in URLs.

## References

- MDN fetch: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
- AbortSignal.timeout / any: https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal
- axios docs: https://axios-http.com/docs/intro ; axios-retry: https://github.com/softonic/axios-retry
- ky: https://github.com/sindresorhus/ky
- got: https://github.com/sindresorhus/got
- msw: https://mswjs.io/docs/
- openapi-fetch: https://openapi-ts.dev/openapi-fetch/
