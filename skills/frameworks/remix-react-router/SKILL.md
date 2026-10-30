---
name: remix-react-router
description: Build and maintain React Router v7 framework-mode and Remix v2 applications: route configuration and nested routing, loaders and actions, Form/fetcher mutations, error boundaries, sessions and cookies, type-safe route modules, SSR and deployment (Node, Vercel, Cloudflare). Use when a project depends on react-router with @react-router/dev, or on @remix-run/react and @remix-run/node, or when editing app/routes.ts, app/root.tsx or route modules with loader/action exports.
---

# Remix and React Router v7

Assumes React Router 7 in framework mode (`@react-router/dev`, `react-router.config.ts`) or Remix 2 (`@remix-run/*`). React Router 7 is the continuation of Remix 2; the concepts are identical and the APIs differ mostly in import paths. Remix v3 (2025 preview) is a separate, non-React project; this skill does not cover it. Component-level React guidance lives in the `react` skill.

## When to use

- Adding routes, layouts, loaders, actions, error boundaries, meta/links.
- Forms and mutations, optimistic UI, pending states, revalidation.
- Sessions, cookies, authentication, redirects.
- Choosing framework vs data vs declarative mode; SSR, prerendering, deployment targets.
- Writing tests for route modules and components that use router hooks.

## Project conventions to detect first

1. Which library and mode:
   - React Router 7 framework mode: `react-router` + `@react-router/dev` + `@react-router/node` (or `/cloudflare`), `react-router.config.ts`, `app/routes.ts`, `app/root.tsx`, `vite.config.ts` with `reactRouter()`.
   - React Router 7 data mode (SPA): `createBrowserRouter` + `RouterProvider`, no `@react-router/dev`. Loaders/actions exist but run in the browser.
   - React Router declarative mode: `<BrowserRouter>` + `<Routes>`; no loaders. Use `react` skill plus the routing parts below.
   - Remix 2: `@remix-run/react`, `@remix-run/node` (or `/cloudflare`, `/deno`), `remix.config.js` (classic compiler, legacy) or `vite.config.ts` with `remix()` plugin, `app/routes/*` flat-file routes.
2. Route config style: `app/routes.ts` with `route()`/`index()`/`layout()`/`prefix()` from `@react-router/dev/routes`, or `flatRoutes()` from `@react-router/fs-routes` (Remix-style file naming: `_index.tsx`, `posts.$id.tsx`, `_layout.tsx`, `posts_.new.tsx`).
3. Typegen: `.react-router/types/` and `import type { Route } from './+types/<name>'` means route types are generated (`react-router typegen`, usually in `dev` and `typecheck` scripts). Keep using them.
4. `react-router.config.ts`: `ssr: true|false`, `prerender`, `basename`, `future` flags (`unstable_middleware`/`v8_middleware`, `unstable_optimizeDeps`). Remix: `future.v3_*` flags in the Vite plugin.
5. Sessions: `createCookieSessionStorage`, `createMemorySessionStorage`, custom DB-backed storage, or an auth library (`remix-auth`, `better-auth`, Clerk).
6. Data layer in `app/.server/` or `*.server.ts` files (excluded from the client bundle), ORM (`prisma`, `drizzle-orm`).
7. Styling: Tailwind, CSS Modules, `links()` exports for stylesheets, shadcn/ui.
8. Tests: Vitest + RTL with `createRoutesStub`, Playwright/Cypress for flows; `msw` for network.
9. Deployment target: `@react-router/serve` (Node), `@react-router/cloudflare` + `wrangler.toml`, `@vercel/react-router`, Docker, Netlify, Fly.

## Core guidance

### Route configuration

```ts
// app/routes.ts (React Router 7)
import { type RouteConfig, index, layout, prefix, route } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('login', 'routes/login.tsx'),
  layout('routes/dashboard/layout.tsx', [
    ...prefix('dashboard', [
      index('routes/dashboard/index.tsx'),
      route('projects/:id', 'routes/dashboard/project.tsx'),
    ]),
  ]),
  route('api/health', 'routes/api/health.ts'),  // resource route: loader only, no default export
  route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig;
```

- Nested routes render in the parent's `<Outlet />`; `layout()` adds a UI parent without a URL segment. `:id` dynamic segments, `*` splat, `?` optional (`route(':lang?/about', ...)`).
- `app/root.tsx` exports `Layout` (html shell with `<Meta />`, `<Links />`, `<Scripts />`, `<ScrollRestoration />`), default `App` rendering `<Outlet />`, and `ErrorBoundary`. Use `Layout` so the error boundary gets the same shell.
- Remix 2 flat routes: `app/routes/posts.$id.tsx` is `/posts/:id`, `_index.tsx` is the index, `_auth.login.tsx` nests under pathless layout `_auth.tsx`, trailing underscore `posts_.new.tsx` escapes nesting. Same semantics via `flatRoutes()` in RR7.

### Route modules

```tsx
// app/routes/dashboard/project.tsx
import type { Route } from './+types/project';
import { data, redirect, Form, isRouteErrorResponse, useNavigation } from 'react-router';
import { requireUser } from '~/lib/auth.server';
import { db } from '~/lib/db.server';

export async function loader({ params, request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const project = await db.project.findFirst({ where: { id: params.id, ownerId: user.id } });
  if (!project) throw data('Not found', { status: 404 });
  return { project };
}

export async function action({ params, request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const name = String(form.get('name') ?? '').trim();
  if (!name) return data({ error: 'Name is required' }, { status: 400 });
  await db.project.update({ where: { id: params.id, ownerId: user.id }, data: { name } });
  return redirect(`/dashboard/projects/${params.id}`);
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.project.name ?? 'Project' }];
}

export default function Project({ loaderData, actionData }: Route.ComponentProps) {
  const nav = useNavigation();
  return (
    <Form method="post">
      <input name="name" defaultValue={loaderData.project.name} aria-invalid={!!actionData?.error} />
      {actionData?.error ? <p role="alert">{actionData.error}</p> : null}
      <button disabled={nav.state !== 'idle'}>Save</button>
    </Form>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(error)) return <p>{error.status} {error.data}</p>;
  return <p>Something went wrong</p>;
}
```

Exports available: `loader`, `clientLoader` (+ `clientLoader.hydrate`), `action`, `clientAction`, `default`, `ErrorBoundary`, `HydrateFallback`, `meta`, `links`, `headers`, `handle`, `shouldRevalidate`. Remix 2 is the same with `LoaderFunctionArgs`/`ActionFunctionArgs` types from `@remix-run/node` and `useLoaderData<typeof loader>()` instead of props.

### Loaders and actions

- `loader` runs on the server (framework mode) for `GET`; `action` for `POST`/`PUT`/`PATCH`/`DELETE`. Both receive `{ request, params, context }` and return data or a `Response`.
- Return plain objects (RR7 serialises with turbo-stream, so `Date`, `Map`, `Promise` survive). Use `data(value, { status, headers })` for status/headers; `json()` is Remix 2 only and deprecated in RR7.
- Throw `data(..., { status: 404 })` or a `Response` to reach the nearest `ErrorBoundary`; `redirect(url, init)` to navigate. Both are thrown, so never wrap them in `try/catch`.
- After any action completes, every loader on the page revalidates automatically. Control it per route with `shouldRevalidate`.
- Parallelism: nested loaders run in parallel; do not `fetch` the parent's data again, use `useRouteLoaderData('routes/parent')` or `matches`.
- Streaming: return a promise in the loader (not awaited) and render with `<Await resolve={promise}>` inside `<Suspense>`.
- Server-only modules: `*.server.ts` or an `.server/` folder; importing them from client code fails the build. `*.client.ts` for the reverse.
- `clientLoader` for browser-side caching or client-only data; `HydrateFallback` renders while `clientLoader.hydrate = true` runs on first load.
- Middleware (`unstable_middleware` / `future.v8_middleware` in 7.9+) and `context` typing changed across 7.x minors; check the installed version's docs at https://reactrouter.com/how-to/middleware before using it.

### Forms, fetchers, navigation state

- `<Form method="post">` navigates and calls the route `action`; `action="/other"` targets another route's action. Works before hydration.
- `useFetcher()` for mutations that must not navigate (toggle, delete in a list, autosave): `fetcher.Form`, `fetcher.submit(data, { method: 'post', action })`, `fetcher.state`, `fetcher.data`. One fetcher per concurrent item (`key` option).
- Pending UI: `useNavigation().state` (`idle | loading | submitting`), `navigation.formData` for optimistic rendering; `fetcher.formData` likewise.
- Data hooks: `loaderData`/`actionData` props (RR7 typegen), `useLoaderData()`, `useActionData()`, `useRouteLoaderData(routeId)`, `useMatches()`, `useParams()`, `useSearchParams()`, `useSubmit()`, `useNavigate()` (prefer `<Link>`/`<Form>`; `redirect` from actions).
- Links: `<Link to prefetch="intent">`, `<NavLink>` with `className={({ isActive }) => ...}`, relative links resolve against the route hierarchy.
- Validation: parse `formData` with zod (or `conform` / `remix-hook-form`), return field errors with 400, repopulate inputs with `defaultValue` from `actionData`.

### Error boundaries

- Export `ErrorBoundary` per route to localise failures; the nearest one above the throwing route renders. `isRouteErrorResponse(error)` distinguishes thrown `data`/`Response` (expected: 404, 403) from unexpected errors (`error instanceof Error`).
- The root `ErrorBoundary` is the last resort; keep it dependency-free. In production, unexpected error messages are sanitised; log them in `entry.server.tsx`'s `handleError` (Remix/RR7 server entry).
- `headers()` export composes response headers from parent routes (`loaderHeaders`, `parentHeaders`).

### Sessions and auth

```ts
// app/lib/session.server.ts
import { createCookieSessionStorage, redirect } from 'react-router'; // '@remix-run/node' in Remix 2

export const sessionStorage = createCookieSessionStorage({
  cookie: { name: '__session', httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production', secrets: [process.env.SESSION_SECRET!] },
});

export async function requireUser(request: Request) {
  const session = await sessionStorage.getSession(request.headers.get('Cookie'));
  const userId = session.get('userId');
  if (!userId) throw redirect('/login?redirectTo=' + encodeURIComponent(new URL(request.url).pathname));
  return getUserById(userId);
}

export async function login(request: Request, userId: string) {
  const session = await sessionStorage.getSession(request.headers.get('Cookie'));
  session.set('userId', userId);
  return redirect('/', { headers: { 'Set-Cookie': await sessionStorage.commitSession(session) } });
}
```

- Cookie sessions hold small, signed data; use a DB/Redis-backed storage (`createSessionStorage`) for anything larger or revocable.
- Always return `Set-Cookie` via the response headers of the loader/action that mutates the session; flash messages via `session.flash()` + commit.
- Authorise in every loader and action that touches protected data; layout loaders are not guards because child routes load in parallel.

### Rendering modes and deployment

- `react-router.config.ts`: `ssr: true` (default) for server rendering; `ssr: false` produces a SPA with `clientLoader`s and a single `index.html`; `prerender: ['/', '/about']` or `prerender: async () => [...]` writes static HTML at build for listed paths (works with or without SSR).
- Build: `react-router build` emits `build/client` (static assets) and `build/server/index.js`. Serve with `react-router-serve ./build/server/index.js` or a custom Express/Hono server using `createRequestHandler` from `@react-router/express`/`@react-router/node`.
- Cloudflare: `@react-router/cloudflare` (or the official Cloudflare Vite plugin template), `wrangler.toml`, `context.cloudflare.env` for bindings. Vercel: `@vercel/react-router` preset in `react-router.config.ts`. Templates: https://github.com/remix-run/react-router-templates.
- Remix 2: `remix vite:build` then `remix-serve ./build/server/index.js`; same client/server split.
- Environment variables are available in loaders/actions via `process.env` (Node) or `context.cloudflare.env`; expose to the client only by returning them from a loader.

## Common tasks

### Add a route

1. Add `route('path', 'routes/file.tsx')` in `app/routes.ts` (or create the flat-route file in Remix).
2. Create the module with `loader`, default component, `meta`, and `ErrorBoundary`.
3. Run `npx react-router typegen` (or `npm run typecheck`) so `./+types/file` exists; import `Route` types.
4. Link to it with `<Link to>`; add a nav `<NavLink>` if needed.

### Add a mutation

1. `action` in the route module: auth check, parse `formData`, validate, write, `redirect` or return `data({ error }, { status: 400 })`.
2. `<Form method="post">` or `useFetcher()`; pending state from `useNavigation`/`fetcher.state`; optimistic UI from `formData`.
3. If other routes' data changes, rely on automatic revalidation; tune with `shouldRevalidate` only when measured.

### Add a resource route (API/webhook/file download)

1. Route module with `loader` and/or `action` and no default export.
2. Return `new Response(body, { headers: { 'Content-Type': ... } })` or `data()`. Verify webhook signatures from the raw body (`await request.text()`).

### Protect routes

1. `requireUser(request)` at the top of each protected `loader` and `action` (throws a redirect).
2. For a shared layout, also show user info from the layout loader, but do not rely on it for authorisation.
3. Logout action destroys the session: `sessionStorage.destroySession(session)` in `Set-Cookie`.

### Test a route module

```tsx
import { createRoutesStub } from 'react-router';
import { render, screen } from '@testing-library/react';
import Project from './project';

test('renders project', async () => {
  const Stub = createRoutesStub([{ path: '/p/:id', Component: Project, loader: () => ({ project: { id: '1', name: 'Alpha' } }) }]);
  render(<Stub initialEntries={['/p/1']} />);
  expect(await screen.findByDisplayValue('Alpha')).toBeInTheDocument();
});
```

Test `loader`/`action` directly: `await action({ request: new Request('http://x/p/1', { method: 'POST', body: formData }), params: { id: '1' }, context: {} })`. Use Playwright for flows that depend on SSR, redirects and cookies.

### Migrate Remix 2 to React Router 7

1. Enable all `future.v3_*` flags in Remix and fix warnings.
2. `npx codemod remix/2/react-router/upgrade` rewrites imports (`@remix-run/react` to `react-router`, `@remix-run/node` to `@react-router/node`) and scripts.
3. Add `react-router.config.ts`, `app/routes.ts` (use `flatRoutes()` to keep file routes), switch Vite plugin to `reactRouter()`, run typegen, replace `json()`/`defer()` with plain returns or `data()`.

## Pitfalls

- Fetching in `useEffect` for data a loader should provide (loses SSR, revalidation and error handling).
- Wrapping `redirect()`/thrown `data()` in `try/catch`, or returning a redirect from inside a helper without `throw`/`return`.
- Importing server modules (db, env) into components or `clientLoader`; name them `*.server.ts`.
- Expecting layout loaders to guard child routes.
- Using the same `useFetcher()` instance for many list items (states collide); pass a `key`.
- Mutating via `fetch('/api')` in event handlers and then manually refetching, instead of `fetcher.submit` which revalidates loaders.
- Forgetting `Set-Cookie` headers when committing a session, so the login never sticks.
- Returning non-serialisable values from loaders in Remix 2 (`json()` drops `Date` to string); RR7 keeps them but still disallows functions/class instances.
- `useNavigate()` for things a `<Link>`/`<Form>` should do (breaks progressive enhancement and prefetching).
- Missing `ErrorBoundary` on data routes, so a 404 bubbles to the root and unmounts the whole layout.
- Running typegen only locally; add `react-router typegen` to the `typecheck`/`build` scripts so CI matches.

## Verification

```bash
cat package.json | jq .scripts
npx react-router typegen && npx tsc --noEmit      # RR7; Remix 2: npx tsc --noEmit
npm run lint                                      # eslint (react, react-hooks, jsx-a11y)
npx vitest run                                    # unit + createRoutesStub tests
npx react-router build                            # Remix 2: npx remix vite:build
npx playwright test                               # e2e if configured
```

## References

- React Router 7 framework docs: https://reactrouter.com/start/framework/installation
- Route module API: https://reactrouter.com/start/framework/route-module
- Data loading, actions, sessions: https://reactrouter.com/start/framework/data-loading, https://reactrouter.com/start/framework/actions, https://reactrouter.com/explanation/sessions-and-cookies
- Deployment templates: https://github.com/remix-run/react-router-templates
- Remix 2 docs (legacy): https://remix.run/docs/en/main
- Upgrading Remix to React Router 7: https://reactrouter.com/upgrading/remix
