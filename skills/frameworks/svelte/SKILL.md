---
name: svelte
description: Build and maintain Svelte 5 (runes: $state, $derived, $effect, $props, snippets) and SvelteKit 2 applications, with notes for Svelte 4 legacy syntax; covers routing and layouts, load functions, form actions, server vs client code, stores vs runes, hooks, adapters, Vite, Vitest and Playwright. Use when editing .svelte or .svelte.ts files, or a project that depends on svelte or @sveltejs/kit or has svelte.config.js.
---

# Svelte and SvelteKit

Assumes Svelte 5 with runes and SvelteKit 2. Svelte 4 syntax (`export let`, `$:`, `on:click`, slots) still compiles in Svelte 5 "legacy mode" per component, but new components should use runes. Check `svelte` and `@sveltejs/kit` versions in `package.json`.

## When to use

- Creating or changing `.svelte` components, shared reactive state in `.svelte.ts` files, or stores.
- SvelteKit routes: `+page`, `+layout`, `+server`, load functions, form actions, hooks, error pages.
- Choosing server vs client code, rendering options (SSR/CSR/prerender), adapters and deployment.
- Writing component tests (Vitest) and e2e tests (Playwright).
- Migrating Svelte 4 to 5, or stores to runes.

## Project conventions to detect first

1. Svelte major version. 5 enables runes, snippets, event attributes; a 4.x project must not receive runes code. Mixed codebases: a component is in runes mode as soon as it uses any rune; do not mix `export let` and `$props()` in one file.
2. SvelteKit present (`@sveltejs/kit`, `src/routes/`) or plain Svelte + Vite (`src/main.ts` with `mount(App, { target })`).
3. `svelte.config.js`: `kit.adapter` (`adapter-auto`, `adapter-node`, `adapter-static`, `adapter-vercel`, `adapter-netlify`, `adapter-cloudflare`), `kit.alias`, `preprocess` (`vitePreprocess`), `compilerOptions.runes` (forces runes mode everywhere if `true`).
4. TypeScript: `lang="ts"` in script tags, `src/app.d.ts` declaring `App.Locals`, `App.PageData`, `App.Error`, `App.Platform`.
5. State: runes in `.svelte.ts` modules, `svelte/store` stores, or both. New shared state should use runes unless the project standardises on stores.
6. Styling: scoped `<style>`, Tailwind (`app.css` with `@import "tailwindcss"` or `tailwind.config.*`), UnoCSS, component libraries (shadcn-svelte, Skeleton, Flowbite Svelte, Bits UI, Melt UI).
7. Forms and validation: `sveltekit-superforms` + `zod`/`valibot`, or plain form actions with `fail()`.
8. Data: `drizzle-orm`/`prisma` used in `$lib/server`; auth via `@auth/sveltekit`, `lucia`, or `better-auth`.
9. Tests: `vitest.config.ts`/`vite.config.ts` `test` block, `@testing-library/svelte` or `vitest-browser-svelte`, `playwright.config.ts`. Lint: `eslint-plugin-svelte`, `prettier-plugin-svelte`, `svelte-check`.
10. Tooling: `npx sv` (the official CLI) for `create`, `add`, `check`, `migrate`; older projects used `npm create svelte`.

## Core guidance

### Svelte 5 components

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    count?: number;
    onchange?: (n: number) => void;
    children?: Snippet;
    row?: Snippet<[item: string]>;
  }
  let { title, count = $bindable(0), onchange, children, row }: Props = $props();

  let doubled = $derived(count * 2);
  let items = $state<string[]>([]);

  $effect(() => {
    document.title = `${title} (${count})`;
    return () => { /* cleanup when deps change or component unmounts */ };
  });

  function inc() { count += 1; onchange?.(count); }
</script>

<h2>{title}</h2>
<button onclick={inc}>Count {count}, doubled {doubled}</button>
{@render children?.()}
{#each items as item (item)}
  {@render row?.(item)}
{/each}
```

- `$state` for reactive variables; objects and arrays become deep proxies, so `items.push(x)` is reactive. `$state.raw` for large immutable data (reassign to update). `$state.snapshot(obj)` to get a plain object for logging or `structuredClone`.
- `$derived(expr)` for synchronous derivations, `$derived.by(() => {...})` for multi-statement ones. Never write to a `$derived`.
- `$effect` for side effects outside the component (DOM libraries, timers, analytics). Not for deriving state. It tracks what it reads synchronously; reads after `await` are not tracked. `$effect.pre` runs before DOM updates.
- `$props()` replaces `export let`; defaults via destructuring; `$bindable()` for props that parents may `bind:`. Rest props: `let { class: cls, ...rest } = $props()` then `{...rest}`.
- Events are attributes: `onclick`, `oninput`, `onsubmit`. Component events are callback props (`onchange`), not `createEventDispatcher`. Modifiers are gone; call `e.preventDefault()` in the handler.
- Snippets replace slots: `children` is the default content; named snippets are props typed `Snippet<[args]>`; render with `{@render name(args)}`. Define inline with `{#snippet row(item)}...{/snippet}` inside the component tag.
- Shared reactive state lives in `.svelte.ts` modules: export a class with `$state` fields or an object; export functions to mutate rather than exporting a reassigned primitive.

```ts
// src/lib/state/cart.svelte.ts
class Cart {
  items = $state<Item[]>([]);
  total = $derived(this.items.reduce((s, i) => s + i.price, 0));
  add(item: Item) { this.items.push(item); }
}
export const cart = new Cart();
```

- Stores (`writable`, `readable`, `derived` from `svelte/store`) still work and `$store` auto-subscription works in runes mode. Keep them for existing code and for interop with libraries; prefer runes for new state. Stores-to-runes guide: [references/migration.md](references/migration.md).
- `<svelte:boundary onerror={...}>` (5.3+) with a `failed` snippet catches render errors in a subtree.
- `bind:value`, `bind:checked`, `bind:this={el}` unchanged. `use:action` for element-level behaviour; `transition:`/`in:`/`out:` unchanged.
- Mount a plain Svelte app with `mount(App, { target: document.getElementById('app')! })` from `svelte` (not `new App()`).

### Svelte 4 (legacy mode)

`export let prop`, `$: derived = a + b`, `on:click`, `<slot />`/`<slot name>`, `createEventDispatcher`, `$$props`/`$$restProps`. Edit such files in their own idiom unless the task is migration. Run `npx sv migrate svelte-5` for an automated first pass, then review every `$:` block that had side effects (becomes `$effect`) versus pure derivation (`$derived`).

### SvelteKit routing

| File in `src/routes/...` | Role |
|---|---|
| `+page.svelte` | Page component; receives `data` and `form` props |
| `+page.ts` | Universal `load` (runs server + client); no secrets |
| `+page.server.ts` | Server-only `load` and `actions`; can use `$lib/server`, DB, cookies |
| `+layout.svelte`, `+layout.ts`, `+layout.server.ts` | Same for layouts; render `{@render children()}` |
| `+server.ts` | Endpoint: `export const GET/POST: RequestHandler` returning `Response` (`json()`, `text()` helpers) |
| `+error.svelte` | Nearest error UI; reads `page.error` and `page.status` |
| `[slug]`, `[...rest]`, `[[optional]]`, `(group)` | Dynamic, rest, optional segments; groups do not affect URL |
| `src/hooks.server.ts` | `handle({ event, resolve })` for auth/session into `event.locals`, `handleError`, `handleFetch` |
| `src/app.html`, `src/app.d.ts`, `src/error.html` | Shell, types, fallback error page |

- `$lib` aliases `src/lib`; `$lib/server` is importable only from server files (enforced at build).
- Navigation: `<a href>` works natively (SvelteKit intercepts); `goto()`, `invalidate()`, `invalidateAll()`, `preloadData()` from `$app/navigation`. `data-sveltekit-preload-data="hover"` on links or `<body>`.
- Reactive page state: `import { page } from '$app/state'` (Kit 2.12+, rune-based: `page.url`, `page.params`, `page.data`); older code uses `$page` from `$app/stores` (deprecated).
- Page options exported from `+page(.server).ts` / `+layout(.server).ts`: `prerender`, `ssr`, `csr`, `trailingSlash`, `config` (adapter-specific). Set `prerender = true` in the root layout for a fully static site.

### Load functions

```ts
// src/routes/posts/[slug]/+page.server.ts
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, fetch, setHeaders, depends }) => {
  depends('app:post');
  const post = await locals.db.post.findUnique({ where: { slug: params.slug } });
  if (!post) error(404, 'Post not found');
  setHeaders({ 'cache-control': 'max-age=60' });
  return { post, comments: locals.db.comment.findMany({ where: { postId: post.id } }) }; // promise streams
};
```

- Return plain serialisable objects (devalue handles `Date`, `Map`, `Set`, `BigInt`). Top-level promises stream to the client; render them with `{#await data.comments}`.
- Use the provided `fetch` (forwards cookies, works during SSR, dedupes into the HTML payload) rather than global `fetch`.
- `await parent()` for parent layout data; avoid it when not needed (it serialises waterfalls).
- `error(status, message)` and `redirect(status, location)` from `@sveltejs/kit` throw internally in Kit 2; do not wrap them in `try/catch`, and do not prefix with `throw` (harmless but unnecessary).
- Re-run: `invalidate('app:post')`, `invalidateAll()`, or automatically after a form action or param change. `untrack()` in load to read without creating a dependency.
- Types: `import type { PageServerLoad, PageLoad, LayoutServerLoad, Actions, RequestHandler } from './$types'`; in components `import type { PageProps } from './$types'` (Kit 2.16+) or `PageData`.

### Form actions

```ts
// +page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
  create: async ({ request, locals }) => {
    const data = await request.formData();
    const title = String(data.get('title') ?? '').trim();
    if (!title) return fail(400, { title, missing: true });
    await locals.db.post.create({ data: { title } });
    redirect(303, '/posts');
  },
};
```

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';
  let { form } = $props();
</script>
<form method="POST" action="?/create" use:enhance>
  <input name="title" value={form?.title ?? ''} aria-invalid={form?.missing} />
  <button>Create</button>
</form>
```

- Actions receive `FormData`; validate server-side (zod/valibot or `sveltekit-superforms`). `fail(status, data)` returns to the page with `form` populated; a plain return is a success payload; `redirect` for PRG.
- `use:enhance` progressively enhances (works without JS). Customise with `use:enhance={({ formData, cancel }) => { return async ({ result, update }) => { await update(); } }}` for optimistic UI or toasts. `applyAction(result)` when handling manually.
- Default action: `default` key and `<form method="POST">` with no `action`. Named actions cannot coexist with `default`.
- `+server.ts` endpoints are for JSON/APIs consumed by `fetch` or third parties; form actions are for same-app mutations.

### Server vs client

- Server-only: `+page.server.ts`, `+layout.server.ts`, `+server.ts`, `hooks.server.ts`, `$lib/server/**`, `$env/static/private`, `$env/dynamic/private`. Anything else may run in the browser.
- Env: `$env/static/public` and `$env/dynamic/public` expose only `PUBLIC_`-prefixed variables. `static` is inlined at build; `dynamic` is read at runtime (needed for adapter-node containers).
- `browser`, `dev`, `building` from `$app/environment` to guard code paths. `onMount` runs only in the browser.
- Session: in `hooks.server.ts` read the cookie, load the user, set `event.locals.user`; layouts return `{ user: locals.user }` so pages see it. Authorise again inside actions and endpoints; a layout `load` is not a guard because child pages can be hit directly and layout loads do not re-run on every navigation.

### Adapters and deployment

- `adapter-auto` picks Vercel/Netlify/Cloudflare on their CI; install the specific adapter for predictable builds and config (`npx sv add` or `npm i -D @sveltejs/adapter-node`).
- `adapter-node`: `npm run build` then `node build` (env `PORT`, `ORIGIN`, `BODY_SIZE_LIMIT`); set `ORIGIN` or form actions fail CSRF checks.
- `adapter-static`: requires every route prerenderable (`export const prerender = true` in root layout) or `fallback: 'index.html'` for SPA mode.
- `adapter-vercel`/`-netlify`/`-cloudflare`: per-route `config` for runtime/regions; `platform` in `event.platform` for Cloudflare bindings (type via `App.Platform`).

## Common tasks

### Add a page with data

1. `src/routes/<path>/+page.server.ts` with `load` (or `+page.ts` if no secrets and it should run client-side too).
2. `+page.svelte` reading `let { data }: PageProps = $props()`; `{#await}` for streamed promises.
3. `+error.svelte` at the appropriate level; `error(404)` in load for missing entities.
4. Set `prerender`/`ssr` options if the page is static or client-only.

### Add a mutation

1. Action in `+page.server.ts`; validate; `fail` or `redirect`.
2. `<form method="POST" use:enhance>` in the page; show `form?.error`.
3. For non-form mutations (keyboard shortcut, drag/drop) use `fetch` against the action with `deserialize` from `$app/forms`, or a `+server.ts` endpoint.

### Add shared client state

1. `src/lib/state/<name>.svelte.ts` exporting a class instance or functions over `$state`.
2. For per-request server state, never use module-level `$state` on the server; pass data through `load` and `event.locals`. For context-scoped state use `setContext`/`getContext` in the root layout.

### Add an endpoint

```ts
// src/routes/api/items/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ url, locals }) => json(await locals.db.item.findMany({ take: Number(url.searchParams.get('limit') ?? 20) }));
```

### Test

```ts
// src/lib/Counter.svelte.test.ts  (.svelte.test.ts allows runes in the test file)
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import Counter from './Counter.svelte';

test('increments', async () => {
  render(Counter, { props: { count: 1 } });
  await userEvent.click(screen.getByRole('button'));
  expect(screen.getByText(/2/)).toBeInTheDocument();
});
```

- Vitest config: `environment: 'jsdom'`, `resolve.conditions: ['browser']` for client tests (or the `sveltekit()` plugin's test projects generated by `npx sv add vitest`). Load functions and actions test as plain functions with a fake `event`.
- Playwright (`npx sv add playwright`) for flows depending on SSR, forms without JS, and redirects. Run with `npx playwright test`.
- `svelte-check` (`npx sv check`) catches template type errors Vitest will not.

## Pitfalls

- Mixing Svelte 4 and 5 syntax in one component (`export let` with `$state`): compile error.
- Destructuring `$state` objects or passing `$state` primitives into functions and expecting reactivity: pass getters (`() => count`) or the object itself.
- Using `$effect` to compute state that should be `$derived`; or writing state inside `$effect` that it also reads (loop).
- `$derived` with side effects or async work; it must be pure and synchronous.
- Module-level `$state` or stores in server code (shared across requests). Use `event.locals` and `load`.
- Importing `$lib/server` or private env from a universal `+page.ts` or component (build fails).
- Using global `fetch` in `load` instead of the provided `fetch` (loses cookies and SSR dedupe).
- Wrapping `redirect()`/`error()` in `try/catch`, swallowing them.
- Treating a layout `load` as an auth guard; enforce in `hooks.server.ts` or in each server load/action.
- `adapter-node` without `ORIGIN`, causing "Cross-site POST form submissions are forbidden".
- Keyless `{#each}` on lists that reorder (`{#each items as item (item.id)}`).
- `$app/stores` `$page` in new code (deprecated); use `$app/state`.

## Verification

```bash
cat package.json | jq .scripts
npx sv check                      # svelte-check: template + TS errors (or npm run check)
npm run lint                      # eslint-plugin-svelte + prettier-plugin-svelte
npx vitest run                    # unit/component tests
npx playwright test               # e2e (starts the dev/preview server per config)
npm run build && npm run preview  # adapter build; catches server/client import violations
```

## References

- [references/migration.md](references/migration.md): Svelte 4 to 5 and stores to runes mapping.
- Svelte 5 docs: https://svelte.dev/docs/svelte/overview
- Runes: https://svelte.dev/docs/svelte/what-are-runes
- SvelteKit docs: https://svelte.dev/docs/kit/introduction
- Load functions: https://svelte.dev/docs/kit/load
- Form actions: https://svelte.dev/docs/kit/form-actions
- Adapters: https://svelte.dev/docs/kit/adapters
- sv CLI: https://svelte.dev/docs/cli/overview
