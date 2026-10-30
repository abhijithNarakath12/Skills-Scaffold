---
name: nuxt
description: Build and maintain Nuxt 3 and Nuxt 4 applications, covering directory conventions and auto-imports, file-based routing and layouts, useFetch/useAsyncData data fetching, useState and Pinia, Nitro server routes and middleware, modules, runtime config, rendering modes (SSR, SPA, prerender, ISR via routeRules), @nuxt/test-utils testing, and deployment presets. Use when a project depends on nuxt or has nuxt.config.ts/js, or when working with server/api, pages/, composables/ or nuxi commands.
---

# Nuxt

Assumes Nuxt 3.10+ or Nuxt 4 with Vue 3, TypeScript, Vite and Nitro. Nuxt 2 is end-of-life; stop and confirm before adding features to a Nuxt 2 app (`nuxt` version `^2`). Component-level Vue guidance lives in the `vue` skill.

## When to use

- Adding pages, layouts, components, composables, plugins, or route middleware.
- Fetching data (SSR-safe) with `useFetch`/`useAsyncData`/`$fetch`; sharing state across components or requests.
- Writing server API routes, server middleware, or scheduled/cached handlers in `server/`.
- Configuring modules, runtime config, rendering mode per route, SEO/head tags.
- Building, deploying (Node, Vercel, Netlify, Cloudflare, static) and testing a Nuxt app.

## Project conventions to detect first

1. Version and layout: `nuxt` in `package.json`. Nuxt 4 (and Nuxt 3 with `future: { compatibilityVersion: 4 }`) puts app code under `app/` (`app/pages`, `app/components`, `app/composables`, `app/layouts`, `app/app.vue`) and keeps `server/`, `public/`, `shared/` at the root. Nuxt 3 default keeps everything at the root. Check `srcDir`/`dir` overrides in `nuxt.config.ts` before creating files.
2. `nuxt.config.ts`: `modules`, `runtimeConfig`, `routeRules`, `ssr`, `nitro.preset`, `app.head`, `css`, `imports`, `components`, `experimental`.
3. Modules installed: `@pinia/nuxt`, `@nuxt/content`, `@nuxt/image`, `@nuxt/ui`, `@nuxtjs/tailwindcss` (or Tailwind v4 via Vite plugin), `@nuxtjs/i18n`, `@nuxt/eslint`, `@nuxt/test-utils`, `@sidebase/nuxt-auth`/`nuxt-auth-utils`, `@vueuse/nuxt`. Each module adds auto-imports and config keys; read its docs rather than guessing.
4. Routing: `pages/` present means file-based routing; absent means a single `app.vue` without `<NuxtPage>`.
5. Data strategy: direct `useFetch` to `server/api`, an external API via `runtimeConfig.public.apiBase`, or `@tanstack/vue-query`. Reuse the existing pattern.
6. State: `useState` composables, Pinia stores in `stores/`, or both.
7. Tests: `vitest.config.ts` using `defineVitestConfig` from `@nuxt/test-utils/config`; `test/e2e` with `@nuxt/test-utils/e2e` or Playwright.
8. Package manager and scripts (`dev`, `build`, `generate`, `preview`, `postinstall: nuxt prepare`, `typecheck`).

## Core guidance

### Directory conventions (Nuxt 3 root layout; prefix with `app/` for Nuxt 4)

| Path | Role |
|---|---|
| `app.vue` | Root component; render `<NuxtLayout><NuxtPage /></NuxtLayout>` |
| `pages/` | File routes: `index.vue`, `users/[id].vue`, `[...slug].vue`, `users/[[id]].vue` (optional) |
| `layouts/default.vue` | Wraps pages via `<slot />`; pick per page with `definePageMeta({ layout: 'admin' })` |
| `components/` | Auto-imported; nested folders prefix the name (`components/form/Input.vue` is `<FormInput>`); `.client.vue`/`.server.vue` suffixes |
| `composables/` | Auto-imported top-level exports (`useX`) |
| `utils/` | Auto-imported helpers |
| `middleware/` | Route middleware; `auth.ts` used via `definePageMeta({ middleware: 'auth' })`; `*.global.ts` runs on every route |
| `plugins/` | `defineNuxtPlugin`; `.client.ts`/`.server.ts` suffixes; ordered by filename |
| `server/api/`, `server/routes/`, `server/middleware/`, `server/utils/`, `server/plugins/` | Nitro; `api/` prefixes `/api` |
| `shared/` (Nuxt 4) | Code imported by both app and server (`shared/utils`, `shared/types`) |
| `public/` | Served as-is at `/`; `assets/` is processed by Vite |
| `error.vue` | Full-page error UI (`props.error`, `clearError()`) |
| `.nuxt/` | Generated; never edit, regenerate with `nuxi prepare` |

### Auto-imports

Vue APIs (`ref`, `computed`, `watch`, `onMounted`), Nuxt composables (`useFetch`, `useAsyncData`, `useState`, `useRoute`, `useRouter`, `useRuntimeConfig`, `useHead`, `useSeoMeta`, `useCookie`, `useRequestHeaders`, `useNuxtApp`, `navigateTo`, `createError`, `definePageMeta`, `defineNuxtRouteMiddleware`) and everything in `components/`, `composables/`, `utils/` are available without imports. Explicit imports from `#imports` are allowed and useful in `.ts` files outside the auto-import dirs. Server handlers get h3 helpers (`defineEventHandler`, `readBody`, `getQuery`, `getRouterParam`, `setResponseStatus`) auto-imported. Run `npx nuxi prepare` after adding files if types are missing.

### Data fetching

```vue
<script setup lang="ts">
const route = useRoute();
const { data: user, status, error, refresh } = await useFetch(`/api/users/${route.params.id}`, {
  key: `user-${route.params.id}`,
  pick: ['id', 'name'],
});
if (error.value) throw createError({ statusCode: 404, statusMessage: 'User not found', fatal: true });
</script>
```

- `useFetch(url, opts)` and `useAsyncData(key, () => $fetch(...), opts)` run once on the server during SSR and hydrate on the client without refetching. Use them in `setup` (top level, before any early return). `useLazyFetch`/`lazy: true` avoids blocking navigation; render `status === 'pending'` UI.
- `$fetch` alone is for event handlers, server routes, and inside `useAsyncData` handlers. Calling bare `$fetch` in `setup` fetches twice (server and client).
- Options: `query` (reactive, refetches), `watch: [dep]`, `transform`, `pick`, `server: false` (client only), `immediate: false` then `execute()`, `default: () => []`, `dedupe`, `getCachedData`.
- Reactive URLs: pass a getter `useFetch(() => `/api/users/${id.value}`)` so changes refetch.
- Return shape: `data`, `status` (`'idle' | 'pending' | 'success' | 'error'`), `error`, `refresh`/`execute`, `clear`. `pending` is deprecated; use `status`. In Nuxt 4 `data` defaults to `undefined` (not `null`) before resolution; a `default` option avoids branching.
- Refetch by key from anywhere: `refreshNuxtData('user-1')`. Cookies/headers are forwarded to internal `/api` calls on the server automatically; for external APIs forward with `headers: useRequestHeaders(['cookie'])`.

### State

- `useState<T>('key', () => initial)` creates SSR-serialised, cross-component shared state; wrap it in a composable (`export const useCounter = () => useState('counter', () => 0)`). Keys must be unique app-wide.
- Pinia via `@pinia/nuxt`: stores in `stores/` are auto-imported; state is serialised into the payload. Prefer Pinia when there is business logic; `useState` for small flags.
- `useCookie('name', { maxAge, sameSite })` is reactive state backed by a cookie and works on both server and client.
- Never put module-level `ref`s in a composable file; on the server that state leaks between requests. Use `useState` or Pinia.

### Server routes (Nitro / h3)

```ts
// server/api/users/[id].get.ts
import { z } from 'zod';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const query = await getValidatedQuery(event, z.object({ expand: z.string().optional() }).parse);
  const user = await db.user.find(id);
  if (!user) throw createError({ statusCode: 404, statusMessage: 'User not found' });
  return user; // serialised as JSON
});
```

- File name sets the route and method: `server/api/users/index.post.ts` is `POST /api/users`; without a method suffix the handler receives all methods. `server/routes/` maps to `/` without `/api`.
- Body: `readBody(event)` or `readValidatedBody(event, schema.parse)`; `readMultipartFormData` for uploads. Status: `setResponseStatus(event, 201)`.
- Secrets: `useRuntimeConfig(event)` on the server; only `runtimeConfig.public.*` reaches the client.
- Server middleware (`server/middleware/auth.ts`) runs on every request and should attach data to `event.context`, not return responses, except to throw errors.
- Caching: `defineCachedEventHandler(handler, { maxAge: 60 })`, `cachedFunction`, `useStorage()` for KV (`nitro.storage` config).
- Server utils in `server/utils/` are auto-imported into handlers only. Do not import from `server/` in app code.
- Types for `$fetch('/api/...')` responses are inferred from the handler's return type.

### Runtime config and environment

```ts
export default defineNuxtConfig({
  runtimeConfig: {
    apiSecret: '',                       // NUXT_API_SECRET overrides at runtime
    public: { apiBase: '/api' },         // NUXT_PUBLIC_API_BASE overrides
  },
});
```

Values are typed from the defaults; environment variables with the `NUXT_` prefix override them at runtime (not build time), so Docker images can be reconfigured without rebuilding. Read with `useRuntimeConfig()` in the app and `useRuntimeConfig(event)` on the server. `.env` is loaded in dev and build; in production set real environment variables.

### Rendering modes and route rules

```ts
export default defineNuxtConfig({
  ssr: true,                               // false = pure SPA
  routeRules: {
    '/': { prerender: true },              // built to static HTML
    '/blog/**': { isr: 3600 },             // regenerate at most hourly (Vercel/Netlify) or swr on Node
    '/admin/**': { ssr: false },           // client-only section
    '/api/**': { cors: true, headers: { 'cache-control': 'max-age=60' } },
    '/old': { redirect: '/new' },
  },
});
```

- `nuxi build` produces a server in `.output/`; `nuxi generate` prerenders every discoverable route to `.output/public` for static hosting (needs `nitro.prerender.routes` or crawling for dynamic pages).
- Hybrid rendering is per-route via `routeRules`; avoid a global `ssr: false` for SEO-relevant sites.
- `<ClientOnly>` for components that touch `window` at render; `import.meta.client`/`import.meta.server` for branching; `onMounted` for browser-only code.
- Hydration mismatch sources: dates, random values, `localStorage` reads during render, and `v-if` on client-only state. Move to `onMounted` or `useState` initialised on the server.

### Head, SEO, errors

- `useHead({ title, link, script })` and `useSeoMeta({ title, description, ogImage })` in pages/layouts; global defaults in `app.head`. `titleTemplate` in `app.vue`.
- `definePageMeta({ layout, middleware, name, keepalive, pageTransition })` is compiled, so only static values.
- `createError({ statusCode, statusMessage, fatal: true })` in setup shows `error.vue`; non-fatal errors are available through `useError()`. `<NuxtErrorBoundary>` wraps a section. `showError()` for imperative use.
- Route middleware: `export default defineNuxtRouteMiddleware((to, from) => { if (!loggedIn.value) return navigateTo('/login'); })`; return `abortNavigation()` to cancel.

### Modules and plugins

- Add official modules with `npx nuxi module add <name>` (installs and registers). Module options live under their key in `nuxt.config.ts` (`image: {...}`, `content: {...}`, `i18n: {...}`). Check each module's docs for the auto-imported composables it adds.
- Plugins: `export default defineNuxtPlugin((nuxtApp) => { return { provide: { api: createApi() } } })`, accessible as `useNuxtApp().$api`. Use `.client.ts` for browser-only libraries.
- `nuxt.config.ts` `vite` key passes through to Vite; `nitro` key to Nitro; `typescript.strict` and `typescript.typeCheck` control TS behaviour.

## Common tasks

### Add a page

1. `pages/<path>.vue` (`app/pages` in Nuxt 4) with `<script setup>` and `definePageMeta` if it needs a layout or middleware.
2. Load data with `await useFetch`/`useAsyncData` at the top level; handle `status` and `error`.
3. `useSeoMeta` for title/description. Link to it with `<NuxtLink to="/path">`.
4. For dynamic routes with `nuxi generate`, list the routes in `nitro.prerender.routes` or ensure they are linked from a crawled page.

### Add a server endpoint

1. `server/api/<resource>/<name>.<method>.ts` with `defineEventHandler`.
2. Validate input (`readValidatedBody`/`getValidatedQuery` with zod); throw `createError` for failures.
3. Call it from the app with `useFetch('/api/<resource>')`; the response type is inferred.

### Add shared state

1. Small/simple: `composables/useX.ts` exporting a `useState` wrapper.
2. Structured: install `@pinia/nuxt` (`npx nuxi module add pinia`), create `stores/x.ts` with a setup store; use `storeToRefs`.

### Protect a route

1. `middleware/auth.ts` with `defineNuxtRouteMiddleware`; read the session via a composable (`useUserSession` from `nuxt-auth-utils`, or `useCookie` + `/api/auth/me`).
2. `definePageMeta({ middleware: 'auth' })` on protected pages, or `auth.global.ts` with an allowlist.
3. Enforce authorisation again in the server handler; route middleware runs client-side after hydration and is not a security boundary.

### Deploy

- Node: `npx nuxi build` then `node .output/server/index.mjs` (set `PORT`, `HOST`, `NUXT_*` vars). Docker: copy `.output/` only.
- Vercel/Netlify/Cloudflare Pages: zero-config detection; override with `nitro.preset` or `NITRO_PRESET=cloudflare-pages`. Presets list: `npx nuxi build --help` and https://nitro.build/deploy.
- Static: `npx nuxi generate`, deploy `.output/public`.

### Test

```ts
// test/components/Counter.nuxt.spec.ts  (.nuxt.spec.ts opts the file into the Nuxt environment)
import { mountSuspended, registerEndpoint, mockNuxtImport } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import Counter from '~/components/Counter.vue';

registerEndpoint('/api/count', () => ({ count: 1 }));
mockNuxtImport('useRoute', () => () => ({ params: { id: '1' } }));

describe('Counter', () => {
  it('renders', async () => {
    const wrapper = await mountSuspended(Counter);
    expect(wrapper.text()).toContain('1');
  });
});
```

Set up with `npx nuxi module add test-utils` (adds `@nuxt/test-utils`, Vitest, happy-dom). `vitest.config.ts` uses `defineVitestConfig({ test: { environment: 'nuxt' } })`. E2E: `setup({ server: true })` and `$fetch('/')` from `@nuxt/test-utils/e2e`, or Playwright with `@nuxt/test-utils/playwright`.

## Pitfalls

- Calling `useFetch` inside a function, after `await`, or conditionally: it must run during `setup` to participate in SSR. Use `$fetch` in handlers.
- Bare `$fetch` in `setup` for initial data (double fetch, no hydration payload).
- Same `useFetch` URL in two components without distinct keys when options differ; pass `key`.
- Module-level reactive state in composables leaking across SSR requests.
- Accessing `window`/`document`/`localStorage` in `setup` or during render; move to `onMounted` or `<ClientOnly>`.
- Importing `server/` code into components, or `~/components` into server handlers.
- Expecting `.env` values to apply at runtime in production without `runtimeConfig`; only `NUXT_`-prefixed variables mapped to `runtimeConfig` keys are read at runtime.
- `definePageMeta` with runtime values (it is statically extracted).
- Forgetting `nuxi prepare` (or `postinstall`) in CI, causing missing `.nuxt` types.
- Nuxt 4 path changes: writing to `./pages` when the project uses `app/pages`, or `~/` resolving to `app/` instead of the root. Check `srcDir`.
- Treating route middleware as authentication; the server handler must verify the session.

## Verification

```bash
cat package.json | jq .scripts
npx nuxi prepare                    # regenerate .nuxt types
npx nuxi typecheck                  # vue-tsc over the whole app
npm run lint                        # @nuxt/eslint or eslint-plugin-vue
npx vitest run                      # unit + nuxt environment tests
npx nuxi build                      # production build; failures here include server/import errors
npx nuxi generate                   # only if the site is static
npx nuxi analyze                    # bundle size, when optimising
```

## References

- Nuxt docs (directory structure, composables, config): https://nuxt.com/docs
- Nuxt 4 upgrade guide (new `app/` layout, data fetching changes): https://nuxt.com/docs/getting-started/upgrade
- Data fetching: https://nuxt.com/docs/getting-started/data-fetching
- Nitro server (h3 utilities, storage, presets): https://nitro.build/guide and https://h3.dev
- Testing: https://nuxt.com/docs/getting-started/testing
- Modules directory: https://nuxt.com/modules
