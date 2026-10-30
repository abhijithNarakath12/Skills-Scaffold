---
name: nextjs
description: Build and maintain Next.js 14/15 applications using the App Router (React Server Components, layouts, data fetching and caching, server actions, route handlers, metadata, middleware, next/image and next/font, deployment, testing), with Pages Router treated as legacy. Use when a project depends on next or contains next.config.js/mjs/ts, an app/ or pages/ directory, or when working on routing, caching, server actions or deployment in a Next.js app.
---

# Next.js

Assumes Next.js 14 or 15 with the App Router (`app/`). The Pages Router (`pages/`) is legacy: maintain it, do not add new features to it, and do not mix the two for the same route. Version-specific behaviour is called out; check with `npx next --version`. Next.js 16 changes are noted at the end of Pitfalls.

## When to use

- Adding pages, layouts, loading/error UI, or route handlers under `app/`.
- Fetching data in server components, choosing static vs dynamic rendering, configuring revalidation.
- Writing server actions and forms, middleware, metadata/SEO, image and font handling.
- Debugging hydration errors, "server-only" import errors, stale cache, or build failures.
- Deploying (Vercel, Docker/standalone, static export) and writing tests for a Next.js app.
- Component-level React questions belong to the `react` skill; use this skill for the framework layer.

## Project conventions to detect first

1. Version: `next` in `package.json`. 15 makes `params`, `searchParams`, `cookies()`, `headers()`, `draftMode()` asynchronous and turns off fetch/GET caching by default; 14 keeps them sync and caches `fetch` by default. See [references/caching.md](references/caching.md).
2. Router: `app/` (App Router) or `pages/` (Pages Router). `src/app/` is common; everything below assumes `app/` relative to the project root or `src/`.
3. Config file: `next.config.js`, `.mjs`, or `.ts` (TypeScript config is supported from 15). Look at `images.remotePatterns`, `output`, `experimental`, `redirects`/`rewrites`, `eslint`, `typescript`.
4. Bundler: `next dev --turbo` (14) / `--turbopack` (15) in scripts means Turbopack; webpack customisations in `next.config` do not apply to it.
5. Data layer: direct `fetch` in server components, an ORM (`prisma`, `drizzle-orm`), TanStack Query for client state, `swr`, tRPC. Reuse what exists.
6. Auth: `next-auth`/`auth.js`, `@clerk/nextjs`, `lucia`, custom cookies; note where sessions are read (middleware vs layout vs server actions).
7. Styling: Tailwind (`tailwind.config.*` or `@import "tailwindcss"` for v4), CSS Modules, `styled-components` (requires the registry pattern with RSC), shadcn/ui (`components.json`).
8. Tests: `vitest.config.*` or `jest.config.*` (`next/jest`), `playwright.config.*`, `cypress.config.*`.
9. Lint: `eslint-config-next` via `next lint` (14/15) or a flat `eslint.config.mjs`.

## Core guidance

### Server vs client components

- Everything in `app/` is a Server Component unless the file starts with `'use client'`. Server components can be `async`, read databases, use `process.env` secrets, and ship no JS.
- Add `'use client'` only to leaves that need state, effects, browser APIs, or event handlers. Keep the boundary as low in the tree as possible; pass server-fetched data down as props.
- Server components may render client components and pass them `children` (server content inside a client wrapper). Client components cannot import server components.
- Props crossing the boundary must be serialisable (no functions, class instances, Dates become strings). Server actions are the exception: they can be passed as props.
- Mark modules that must never reach the browser with `import 'server-only'` (package `server-only`); `client-only` for the opposite.
- `useSearchParams` in a client component forces a Suspense boundary for static pages; wrap the component in `<Suspense>`.

### Routing and layouts

File conventions inside a route segment folder:

| File | Purpose |
|---|---|
| `page.tsx` | Route UI; makes the segment publicly reachable |
| `layout.tsx` | Shared shell; persists across navigations, does not re-render on child navigation |
| `template.tsx` | Like layout but remounts per navigation |
| `loading.tsx` | Suspense fallback for the segment (streams) |
| `error.tsx` | Error boundary (`'use client'`, receives `error` and `reset`) |
| `global-error.tsx` | Root error boundary, must render `<html>` and `<body>` |
| `not-found.tsx` | UI for `notFound()` |
| `route.ts` | Route handler; cannot coexist with `page.tsx` in the same folder |
| `default.tsx` | Fallback for parallel routes |

- Root `app/layout.tsx` is required and must render `<html>` and `<body>`.
- Dynamic segments: `[slug]`, catch-all `[...slug]`, optional `[[...slug]]`. Route groups `(marketing)` organise without affecting the URL. Parallel routes `@modal`, intercepting routes `(.)photo`.
- Navigation: `<Link href>` from `next/link`; `useRouter`, `usePathname`, `useSearchParams` from `next/navigation` (never `next/router` in `app/`). Server-side: `redirect()` and `notFound()` from `next/navigation` throw, so call them outside `try/catch`.
- Pre-render dynamic routes with `export async function generateStaticParams()`.
- Page props in 15:

```tsx
export default async function Page({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  // ...
}
```

In 14 the same props are plain objects.

### Data fetching and caching

- Fetch in server components; `fetch` is deduplicated per request automatically. For non-fetch work (ORM calls) wrap in `React.cache()` to dedupe within a request.
- Static vs dynamic is decided per route: using `cookies()`, `headers()`, `searchParams`, `connection()`, or `fetch(..., { cache: 'no-store' })` makes the route dynamic. Force with segment config: `export const dynamic = 'force-dynamic' | 'force-static'`, `export const revalidate = 60`.
- Time-based revalidation: `fetch(url, { next: { revalidate: 3600 } })` or segment `revalidate`. On-demand: `revalidatePath('/posts')` or `revalidateTag('posts')` (tag with `fetch(url, { next: { tags: ['posts'] } })`) from `next/cache`, typically inside a server action or route handler.
- `unstable_cache(fn, keys, { revalidate, tags })` caches non-fetch work across requests (14/15). The `'use cache'` directive is experimental in 15 (`experimental.useCache`/`dynamicIO`); check the installed version's docs before using it.
- Streaming: wrap slow subtrees in `<Suspense fallback>` or add `loading.tsx`; return promises from server components to client components and read them with React 19 `use()`.
- Client-side data (polling, infinite scroll, mutations with optimistic UI) still belongs in TanStack Query/SWR inside client components.

### Server actions

```ts
// app/posts/actions.ts
'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

const schema = z.object({ title: z.string().min(1) });

export async function createPost(prev: { error?: string } | undefined, formData: FormData) {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Title is required' };
  await db.post.create({ data: parsed.data });
  revalidatePath('/posts');
  redirect('/posts');
}
```

```tsx
'use client';
import { useActionState } from 'react'; // Next 15 / React 19; in 14 use useFormState from 'react-dom'
import { useFormStatus } from 'react-dom';
import { createPost } from './actions';

export function PostForm() {
  const [state, action] = useActionState(createPost, undefined);
  return (
    <form action={action}>
      <input name="title" />
      {state?.error ? <p role="alert">{state.error}</p> : null}
      <Submit />
    </form>
  );
}
function Submit() { const { pending } = useFormStatus(); return <button disabled={pending}>Save</button>; }
```

- Always validate and authorise inside the action; it is a public HTTP endpoint. Re-check the session; never trust client-provided ids.
- `redirect()` must be called outside `try/catch`. Return serialisable values only.
- Mutations end with `revalidatePath`/`revalidateTag` so cached pages update.
- `useOptimistic` for instant UI; `router.refresh()` from a client component re-runs server components without losing client state.

### Route handlers

```ts
// app/api/posts/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;              // plain object in 14
  const post = await getPost(id);
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(post);
}
```

- Export `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`. `GET` handlers are cached only when you opt in (`export const dynamic = 'force-static'`) in 15; in 14 they are cached unless they read the request or use `no-store`.
- Use route handlers for webhooks, third-party callbacks, and APIs consumed outside the app. For in-app mutations prefer server actions.
- `export const runtime = 'edge'` only if every dependency is edge-compatible; default is Node.

### Metadata and SEO

- Static: `export const metadata: Metadata = { title: { template: '%s | Site', default: 'Site' }, description }` in layouts/pages.
- Dynamic: `export async function generateMetadata({ params }, parent): Promise<Metadata>`; fetches are deduped with the page.
- File conventions: `app/icon.png`, `app/opengraph-image.tsx` (uses `ImageResponse` from `next/og`), `app/sitemap.ts`, `app/robots.ts`, `app/manifest.ts`.
- `metadataBase` in the root layout so relative OG image URLs resolve.

### Middleware

```ts
// middleware.ts (project root or src/)
import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  if (!req.cookies.get('session') && req.nextUrl.pathname.startsWith('/app')) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ['/app/:path*'] };
```

- Runs on the Edge runtime in 14/15: no Node APIs, no database drivers, keep it to cookie/header checks and redirects. Do full auth checks in the layout/page/action that needs them.
- One `middleware.ts` per project; use `matcher` to avoid running on static assets.

### Images and fonts

- `import Image from 'next/image'`: provide `width`/`height` or `fill` with a positioned parent and `sizes`; `priority` on the LCP image; remote hosts must be listed in `images.remotePatterns`.
- `next/font/google` or `next/font/local` in the root layout; apply via `className` or expose a CSS variable (`variable: '--font-inter'`) for Tailwind. Fonts are self-hosted at build time; no `<link>` to Google Fonts.

### Environment and config

- Only `NEXT_PUBLIC_*` variables reach the browser; they are inlined at build time. Everything else is server-only.
- `.env.local` for secrets (gitignored), `.env` for defaults. Typed access via a validated module (`zod` + `process.env`) is a good pattern.
- Common `next.config` keys: `output: 'standalone'` (Docker), `output: 'export'` (static only, no server features), `images`, `redirects()`, `rewrites()`, `headers()`, `experimental`, `transpilePackages`, `serverExternalPackages` (15; `experimental.serverComponentsExternalPackages` in 14).

## Common tasks

### Add a page with data

1. Create `app/<segment>/page.tsx` as an `async` server component; fetch directly or via a `lib/` data function wrapped in `React.cache`.
2. Add `loading.tsx` (or a `<Suspense>` around the slow part) and `error.tsx` (`'use client'`).
3. Decide rendering: leave static if possible; add `export const revalidate = N` for ISR; `dynamic = 'force-dynamic'` only when per-request data is required.
4. Add `generateMetadata` if the title depends on data.
5. For dynamic segments, add `generateStaticParams` when the set of params is known at build.

### Add a form with a mutation

1. Server action in `actions.ts` with `'use server'`, zod validation, auth check, DB write, `revalidatePath`/`revalidateTag`, then `redirect` or return state.
2. Client form with `useActionState` (15) / `useFormState` (14) and `useFormStatus` for the pending state.
3. Test the action as a plain function with a `FormData` instance.

### Add an API endpoint

1. `app/api/<name>/route.ts` exporting the needed methods.
2. Parse the body with `await req.json()` + zod; return `NextResponse.json`.
3. Set `dynamic`/`revalidate` if the response should be cached.

### Protect routes

1. Light redirect in `middleware.ts` using the session cookie (no DB).
2. Real verification in the protected `layout.tsx`/page or inside each server action (`const session = await auth(); if (!session) redirect('/login')`).

### Debug stale data

1. Identify which cache: Data Cache (fetch), Full Route Cache (static HTML), Router Cache (client, in-memory). See [references/caching.md](references/caching.md).
2. Check for a missing `revalidatePath`/`revalidateTag` after mutation, or a route that is static when it should be dynamic (`next build` prints `○ Static` / `ƒ Dynamic` per route).
3. `router.refresh()` on the client clears the Router Cache for the current route.

### Migrate a Pages Router route

1. Create the equivalent `app/<path>/page.tsx`; move `getServerSideProps` logic into the async component body, `getStaticProps` into the component with `revalidate` config, `getStaticPaths` into `generateStaticParams`.
2. Replace `next/router` with `next/navigation`, `next/head` with `metadata`, `pages/api/*` with `route.ts`.
3. Delete the `pages/` file only after the app route is verified; the routers can coexist for different paths.

## Pitfalls

- Importing a client-only hook (`useState`) in a file without `'use client'`, or importing a server module (DB client) from a client component: fix by moving the boundary, not by adding `'use client'` higher.
- Hydration mismatch from rendering `Date.now()`, `Math.random()`, `window`, or locale-dependent formatting on the server; compute in an effect or pass a stable value from the server.
- Forgetting `await params` / `await searchParams` / `await cookies()` in 15 (sync access logs a warning and will be removed).
- Expecting `fetch` to be cached in 15 (it is not by default) or expecting it to be fresh in 14 (it is cached by default).
- Calling `redirect()` inside `try/catch` (it throws `NEXT_REDIRECT`, which the catch swallows).
- Reading `cookies()`/`headers()` in a layout turns the whole subtree dynamic; read them as deep as possible.
- Server actions without auth checks or validation; they are reachable by anyone who can hit the site.
- `next/image` without `sizes` on `fill` images loads the largest source; remote images without `remotePatterns` throw at runtime.
- Middleware doing database queries on the Edge runtime fails at build or runtime.
- Large `'use client'` boundaries (whole page) negate RSC benefits and ship the data layer to the browser.
- Environment variables accessed as `process.env[name]` with a dynamic key are not inlined for the client.
- Next.js 16 (2025) renames `middleware.ts` to `proxy.ts`, makes Turbopack the default, removes sync access to request APIs and removes `next lint`; if `next` is 16+, confirm these in the release notes before following 14/15 advice.

## Verification

```bash
cat package.json | jq .scripts        # discover the project's commands
npx next lint                         # 14/15 (eslint-config-next); in 16 run eslint directly
npx tsc --noEmit
npm test                              # vitest/jest; async server components need e2e (Playwright), not jsdom
npx next build                        # catches RSC boundary errors, metadata errors, and prints static/dynamic per route
npx playwright test                   # if present
```

Testing notes: Vitest or Jest (`next/jest` preset) with React Testing Library covers client components and synchronous server components; `async` server components are not supported by jsdom-based tests, so cover them with Playwright. Mock `next/navigation` hooks with `vi.mock('next/navigation')` when testing client components that use the router. Test server actions and route handlers as plain functions with `new Request()` / `FormData`.

## References

- [references/caching.md](references/caching.md): the four caches, defaults in 14 vs 15, and how to invalidate each.
- App Router docs: https://nextjs.org/docs/app
- Next.js 15 upgrade guide (async request APIs, caching changes): https://nextjs.org/docs/app/guides/upgrading/version-15
- Server actions: https://nextjs.org/docs/app/getting-started/updating-data
- Route segment config: https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config
- Testing guides (Vitest, Jest, Playwright): https://nextjs.org/docs/app/guides/testing
