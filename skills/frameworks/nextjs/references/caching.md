# Next.js App Router caching

Four caches exist. Know which one is stale before changing config.

| Cache | Where | What | Default 14 | Default 15 | Invalidate |
|---|---|---|---|---|---|
| Request memoization | Server, per request | Identical `fetch` calls (same URL + options) during one render | On | On | Automatic at end of request; use `React.cache()` for non-fetch functions |
| Data Cache | Server, persistent across requests and deploys (Vercel) | `fetch` responses, `unstable_cache` results | `fetch` cached (`force-cache`) | `fetch` not cached (`no-store`) | `revalidateTag`, `revalidatePath`, `next.revalidate` TTL, redeploy for `unstable_cache` |
| Full Route Cache | Server, build output | Rendered HTML + RSC payload of static routes | On for static routes | On for static routes | `revalidatePath`, segment `revalidate`, making the route dynamic |
| Router Cache | Browser memory | RSC payload of visited routes | Dynamic pages cached 30s, static 5min | Dynamic pages not cached (`staleTimes.dynamic = 0`), static 5min | `router.refresh()`, `revalidatePath`/`revalidateTag` in a server action, `cookies.set` in an action, navigation after expiry |

## Opting in and out

```ts
// per fetch
fetch(url, { cache: 'force-cache' });                  // cache indefinitely (15 opt-in)
fetch(url, { cache: 'no-store' });                     // never cache (14 opt-out)
fetch(url, { next: { revalidate: 60 } });              // ISR-style TTL
fetch(url, { next: { tags: ['posts'] } });             // tag for revalidateTag

// per route segment (page.tsx, layout.tsx, route.ts)
export const dynamic = 'force-dynamic';                // always render at request time
export const dynamic = 'force-static';                 // render at build, ignore request data
export const revalidate = 3600;                        // ISR for the whole segment
export const fetchCache = 'default-no-store';          // change fetch default for the segment

// non-fetch work (ORM, SDK)
import { unstable_cache } from 'next/cache';
export const getPosts = unstable_cache(async () => db.post.findMany(), ['posts'], { tags: ['posts'], revalidate: 300 });
```

What makes a route dynamic automatically: `cookies()`, `headers()`, `searchParams`, `connection()`/`unstable_noStore()`, `fetch` with `no-store`, `dynamic = 'force-dynamic'`.

## Invalidating after a mutation

```ts
'use server';
import { revalidatePath, revalidateTag } from 'next/cache';

export async function publish(id: string) {
  await db.post.update({ where: { id }, data: { published: true } });
  revalidateTag('posts');            // every fetch/unstable_cache tagged 'posts'
  revalidatePath('/posts/[id]', 'page'); // a dynamic route pattern
}
```

- `revalidatePath('/')` with no type revalidates that path only; `revalidatePath('/', 'layout')` revalidates everything under it.
- Revalidation marks entries stale; the next request re-renders (stale-while-revalidate for time-based, immediate for on-demand).
- From a route handler (webhook), the same functions work but the browser Router Cache is not cleared until the user navigates or refreshes.

## Reading the build output

`next build` prints each route with a symbol: `○` static (prerendered), `●` SSG with `generateStaticParams`, `ƒ` dynamic (server-rendered per request). If a route you expect to be static is `ƒ`, find the dynamic API call (often a `cookies()` in a shared layout).

## 15.x experimental: `'use cache'`

With `experimental.dynamicIO` (or `experimental.useCache`) enabled, `'use cache'` at the top of a file, component, or function caches its output and `cacheLife()`/`cacheTag()` control it. It is not stable in 15; do not introduce it into a project that has not already opted in. Check https://nextjs.org/docs/app/api-reference/directives/use-cache for the installed version.
