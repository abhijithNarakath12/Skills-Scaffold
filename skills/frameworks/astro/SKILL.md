---
name: astro
description: Build and maintain Astro 4/5 sites: .astro components and layouts, islands architecture with client:* directives and server islands, content collections (Content Layer API), file-based routing and endpoints, SSR adapters and rendering modes, framework integrations (React, Vue, Svelte, Solid), astro:assets images, middleware, actions, and Vitest/Playwright testing. Use when a project depends on astro, has astro.config.mjs/ts, or when editing .astro files.
---

# Astro

Assumes Astro 5 (Content Layer, server islands, `astro:env`) with notes for Astro 4. Check `astro` in `package.json`; Astro 5 differences are flagged. Astro ships zero client JavaScript by default; every piece of interactivity is an explicit opt-in.

## When to use

- Creating pages, layouts, `.astro` components, or framework islands.
- Content collections (blog, docs), Markdown/MDX, data loaders.
- Routing, dynamic routes, API endpoints, middleware, actions, sessions.
- Images, fonts, styles, view transitions.
- Choosing static vs on-demand rendering, adapters, deployment, testing.

## Project conventions to detect first

1. Astro major: 5 uses `src/content.config.ts` with `loader`s, `render(entry)` from `astro:content`, `entry.id`, `output: 'static' | 'server'` (no `hybrid`), `<ClientRouter />`. Astro 4 uses `src/content/config.ts` with `type: 'content'`, `entry.render()`, `entry.slug`, `output: 'hybrid'`, `<ViewTransitions />`.
2. `astro.config.mjs|ts`: `integrations`, `output`, `adapter`, `site`, `base`, `image` (`domains`, `remotePatterns`, `service`), `i18n`, `vite`, `markdown` (`shikiConfig`, `remarkPlugins`), `experimental`, `env.schema`, `security.checkOrigin`.
3. UI frameworks installed: `@astrojs/react`, `@astrojs/vue`, `@astrojs/svelte`, `@astrojs/solid-js`, `@astrojs/preact`, `@astrojs/alpinejs`. Use the existing one for islands; do not add a second framework for one widget.
4. Content: `src/content/` folders, `@astrojs/mdx`, `@astrojs/starlight` (docs theme), `astro:content` usage, Markdoc.
5. Styling: Tailwind (`@tailwindcss/vite` plugin in `vite.plugins` for v4; `@astrojs/tailwind` for v3), scoped `<style>`, Sass, UnoCSS.
6. Adapter: `@astrojs/node` (`mode: 'standalone' | 'middleware'`), `@astrojs/vercel`, `@astrojs/netlify`, `@astrojs/cloudflare`. No adapter means a fully static build.
7. Client state between islands: `nanostores` (`@nanostores/react|vue`), or none.
8. Tests: `vitest.config.ts` using `getViteConfig` from `astro/config`, `playwright.config.ts`, `@astrojs/check` for `astro check`.
9. Package manager and scripts (`dev`, `build`, `preview`, `astro`, `check`).

## Core guidance

### `.astro` components

```astro
---
// src/components/Card.astro: frontmatter runs on the server (build or request), never in the browser
import { Image } from 'astro:assets';
import type { ImageMetadata } from 'astro';

interface Props { title: string; href: string; image?: ImageMetadata; class?: string }
const { title, href, image, class: className } = Astro.props;
const external = href.startsWith('http');
---

<article class:list={['card', className]}>
  {image && <Image src={image} alt="" width={320} />}
  <h3><a href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener' : undefined}>{title}</a></h3>
  <slot />                     <!-- default slot -->
  <slot name="footer">Default footer</slot>
</article>

<style>
  .card { padding: 1rem; }   /* scoped to this component by default */
  :global(body) { margin: 0; }
</style>

<script>
  // Bundled, deduplicated, runs once per page load; type-checked TypeScript
  document.querySelectorAll('.card a').forEach((a) => a.addEventListener('click', () => {}));
</script>
```

- Frontmatter is server-only: top-level `await`, `fetch`, filesystem, secrets are fine. Anything that needs browser state must be a `<script>` or a framework island.
- `Astro.props` (type with `interface Props`), `Astro.params`, `Astro.url`, `Astro.request`, `Astro.cookies`, `Astro.redirect()`, `Astro.locals`, `Astro.site`, `Astro.slots.has('footer')`.
- Template: JSX-like expressions, `class:list`, `set:html={html}` (sanitise first), `set:text`, `define:vars={{ color }}` on `<style>`/`<script>`, `is:inline` to skip bundling, `is:global` for unscoped styles.
- `<script>` tags are hoisted and bundled once per page regardless of how many component instances render. For per-instance behaviour, use a custom element (`class extends HTMLElement`) or `data-*` attributes and query them. A `<script>` with `is:inline` or `define:vars` is not bundled and is emitted where it appears, once per component instance.
- Layouts are ordinary components in `src/layouts/` rendering `<html>`, `<head>`, `<slot />`. Pass `title`/`description` as props; Markdown pages pick a layout via frontmatter `layout:`.

### Islands

```astro
---
import Counter from '../components/Counter.tsx';
import Chart from '../components/Chart.vue';
import Reviews from '../components/Reviews.astro';
---
<Counter client:load initial={1} />          <!-- hydrate immediately -->
<Chart client:visible data={points} />        <!-- hydrate when scrolled into view -->
<Reviews server:defer><p slot="fallback">Loading reviews...</p></Reviews>  <!-- Astro 5 server island -->
```

- Directives: `client:load`, `client:idle`, `client:visible` (optionally `={{ rootMargin }}`), `client:media="(max-width: 600px)"`, `client:only="react"` (skip SSR; must name the framework). No directive renders the framework component to static HTML with no JS.
- Props to islands must be serialisable (no functions). Children passed as slots arrive as `children` (React) or default slot (Vue/Svelte). Islands cannot import `.astro` components.
- Islands are isolated: share state across them with `nanostores` atoms, not React context. Multiple frameworks can coexist; `@astrojs/react` with `include`/`exclude` globs disambiguates JSX if Preact or Solid are also installed.
- Server islands (Astro 5, `server:defer`) render on demand after the static shell, for personalised or slow content; they require an adapter. Pass only serialisable props; `Astro.locals`/cookies are available inside.
- Reach for a plain `<script>` before a framework island for small interactivity (menus, toggles): zero framework runtime shipped.

### Routing and endpoints

- `src/pages/**` maps to URLs: `index.astro`, `about.astro`, `blog/[slug].astro`, `[...path].astro`, `.md`/`.mdx` pages, `.ts`/`.js` endpoints.
- Static dynamic routes need `getStaticPaths()` returning `[{ params, props }]`; on-demand routes read `Astro.params` and return `Astro.redirect('/404')` or `new Response(null, { status: 404 })` when nothing matches.
- Per-page rendering: `export const prerender = false` (on-demand) in a static project, or `prerender = true` in a `server` project.
- Endpoints:

```ts
// src/pages/api/subscribe.ts
import type { APIRoute } from 'astro';
export const prerender = false;
export const POST: APIRoute = async ({ request, locals }) => {
  const { email } = await request.json();
  if (!email) return new Response(JSON.stringify({ error: 'email required' }), { status: 400 });
  await locals.db.subscribe(email);
  return Response.json({ ok: true });
};
```

- Static endpoints (`GET` only, prerendered) are useful for `rss.xml.ts` (`@astrojs/rss`), `sitemap` (`@astrojs/sitemap` integration), JSON feeds.
- Redirects: `redirects` in config for static mappings; `Astro.redirect()` for dynamic.
- i18n: `i18n: { defaultLocale, locales, routing }` in config and helpers from `astro:i18n`.

### Content collections (Astro 5 Content Layer)

```ts
// src/content.config.ts
import { defineCollection, z } from 'astro:content';
import { glob, file } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: ({ image }) => z.object({
    title: z.string(),
    pubDate: z.coerce.date(),
    cover: image().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});
const authors = defineCollection({ loader: file('./src/data/authors.json'), schema: z.object({ name: z.string() }) });

export const collections = { blog, authors };
```

```astro
---
// src/pages/blog/[id].astro
import { getCollection, render } from 'astro:content';
export async function getStaticPaths() {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  return posts.map((post) => ({ params: { id: post.id }, props: { post } }));
}
const { post } = Astro.props;
const { Content, headings } = await render(post);
---
<Layout title={post.data.title}><Content /></Layout>
```

- `getCollection(name, filter?)`, `getEntry(name, id)`, `getEntries(refs)`; `reference('authors')` in schemas for relations.
- Loaders can pull from APIs/CMSs (custom loader objects with `load({ store })`), so collections are not limited to local files. Community loaders exist for most headless CMSs.
- Astro 4: config lives in `src/content/config.ts`, `type: 'content' | 'data'`, entries have `slug`, and you call `entry.render()`. Mixing the two styles fails; follow the installed version.
- Run `astro sync` (or `astro dev`) to regenerate `.astro/` types after schema changes.

### Rendering modes, adapters, deployment

- Default (`output: 'static'`): everything prerendered at build; add an adapter plus `prerender = false` on specific pages/endpoints for on-demand rendering. `output: 'server'` flips the default to on-demand with `prerender = true` opt-in. Astro 4 used `output: 'hybrid'` for the first case.
- Add adapters with `npx astro add node|vercel|netlify|cloudflare`; the command installs and edits the config. Node standalone: `node ./dist/server/entry.mjs` with `HOST`/`PORT`.
- Environment: `import.meta.env.PUBLIC_*` reaches the client; others are server-only. Astro 5 `astro:env` with `env.schema` in config gives typed, validated access (`import { API_KEY } from 'astro:env/server'`).
- `site` must be set for canonical URLs, sitemap and RSS. `base` for sub-path deployments.
- Build output: `dist/` (static) or `dist/client` + `dist/server` (SSR). Preview with `astro preview` (Node adapter or static only).

### Middleware, actions, sessions

```ts
// src/middleware.ts
import { defineMiddleware, sequence } from 'astro:middleware';
const auth = defineMiddleware(async (context, next) => {
  context.locals.user = await getUser(context.cookies.get('session')?.value);
  if (context.url.pathname.startsWith('/admin') && !context.locals.user) return context.redirect('/login');
  return next();
});
export const onRequest = sequence(auth);
```

- Type `locals` by declaring `App.Locals` in `src/env.d.ts`. Middleware runs for on-demand routes at request time and for prerendered pages at build time (so avoid request-specific logic there without checking `isPrerendered`).
- Actions (`src/actions/index.ts`, Astro 4.15+/5): `export const server = { newsletter: defineAction({ accept: 'form', input: z.object({ email: z.string().email() }), handler: async (input, context) => {...} }) }`; call from the client with `actions.newsletter(formData)` from `astro:actions`, or progressively enhance `<form method="POST" action={actions.newsletter}>`. Errors are `ActionError` with codes; `isInputError(error)` for field errors.
- Sessions (Astro 5.7+): `Astro.session.get/set` with a configured driver (`session: { driver }` in config, adapters provide defaults). Check the installed version before using.

### Images and assets

- Local images in `src/assets/`, imported and passed to `<Image src={img} alt="..." />` or `<Picture formats={['avif', 'webp']} />` from `astro:assets`; dimensions are inferred, output is optimised and hashed.
- Remote images need `width` and `height` (or `inferSize`) and an allowlisted host in `image.domains`/`image.remotePatterns`.
- `public/` files are copied verbatim and referenced by absolute path; no optimisation. Use for favicons, `robots.txt`, fonts.
- Markdown images in collections are optimised when referenced relatively; `image()` schema helper validates frontmatter images.
- `getImage()` for programmatic URLs (CSS backgrounds, OG images). Fonts: self-host in `public/fonts` with `@font-face` or use the experimental Fonts API (`experimental.fonts`, Astro 5.7+); verify in docs.

### View transitions and client routing

- Astro 5: `import { ClientRouter } from 'astro:transitions'` in `<head>` enables SPA-like navigation with the View Transitions API; `transition:name`, `transition:animate`, `transition:persist` on elements. Astro 4: `<ViewTransitions />`.
- Scripts that set up listeners must re-run on navigation: listen for `astro:page-load` (or `astro:after-swap`) instead of relying on module execution once.

## Common tasks

### Add a page

1. `src/pages/<path>.astro` using a layout from `src/layouts/`.
2. Fetch data in frontmatter (`await fetch` or `getCollection`); render with expressions.
3. Dynamic: `[param].astro` with `getStaticPaths` (static) or `Astro.params` + `prerender = false` (SSR).
4. Add `<title>`/meta through the layout props; include in sitemap automatically if `@astrojs/sitemap` is installed.

### Add a blog/content collection

1. Define the collection in `src/content.config.ts` (`src/content/config.ts` on Astro 4) with a zod schema.
2. Put entries in `src/content/<collection>/`; frontmatter must satisfy the schema (build fails otherwise).
3. Index page with `getCollection` sorted by date; detail page `[id].astro` with `render(post)`.
4. `npx astro sync` to refresh types; `npx astro check` to verify.

### Add an interactive widget

1. Can a `<script>` with a custom element do it? Prefer that.
2. Otherwise add the framework integration (`npx astro add react`), write `src/components/Widget.tsx`, and render it with the least eager directive that works (`client:visible` or `client:idle`; `client:load` only above the fold).
3. Share state across islands with `nanostores` if required.

### Add an API endpoint or form handler

1. Endpoint in `src/pages/api/<name>.ts` with `export const POST: APIRoute` and `prerender = false`; or an Action in `src/actions/index.ts` for typed form handling.
2. Ensure an adapter is configured; validate input with zod; return `Response.json`.
3. Call it from an island or a plain `<form>`; with Actions use `actions.<name>` and `isInputError`.

### Deploy

1. `npx astro add <adapter>` if any page is on-demand. Confirm `site` in config.
2. `npm run build`; inspect `dist/`. Preview locally with `npm run preview`.
3. Platform-specific settings live in the adapter options (`@astrojs/vercel` `isr`, `@astrojs/cloudflare` `platformProxy`); read the adapter README in `node_modules/@astrojs/<adapter>`.

### Test

- Unit: Vitest with `getViteConfig` so `astro:*` virtual modules resolve:

```ts
// vitest.config.ts
import { getViteConfig } from 'astro/config';
export default getViteConfig({ test: { environment: 'node' } });
```

- Render `.astro` components in tests with the Container API: `const container = await experimental_AstroContainer.create(); const html = await container.renderToString(Card, { props: { title: 'x' } });` (import from `astro/container`; API is marked experimental, check the installed version).
- Framework islands: test them with their own framework's testing library.
- E2E: Playwright against `astro dev` or `astro preview` (set `webServer` in `playwright.config.ts`).

## Pitfalls

- Expecting frontmatter or `.astro` template code to run in the browser (it never does); interactivity needs `<script>` or an island.
- Passing functions, class instances, or `.astro` components as props to islands.
- `client:only` without a framework name, or adding `client:load` to components that need no JS.
- Using Astro 4 collection APIs (`entry.slug`, `entry.render()`, `src/content/config.ts`) on Astro 5, or vice versa.
- Forgetting `export const prerender = false` on endpoints/pages that read request data in a static project (they build once with empty data).
- Remote `<Image>` without dimensions or without `image.domains`/`remotePatterns` (build error or unoptimised passthrough).
- Scripts that attach listeners once and break after client-side navigation with `<ClientRouter />`; re-attach on `astro:page-load`.
- `set:html` with untrusted content.
- Setting `output: 'server'` for a mostly static site (slower, needs a server) when per-page `prerender = false` suffices.
- Missing `site` in config, so RSS/sitemap/canonical URLs are wrong or the integration throws.
- Importing `astro:content` in client-side island code (server-only virtual module).

## Verification

```bash
cat package.json | jq .scripts
npx astro check                  # type-checks .astro files (needs @astrojs/check and typescript)
npx astro sync                   # regenerate content/env types after schema changes
npm run lint                     # eslint-plugin-astro if configured
npx vitest run                   # unit tests
npx astro build                  # validates collections, routes, images, adapter config
npx astro preview                # smoke test the built output
npx playwright test              # e2e if configured
```

## References

- Astro docs: https://docs.astro.build
- Islands and client directives: https://docs.astro.build/en/concepts/islands/, https://docs.astro.build/en/reference/directives-reference/
- Content collections (Content Layer): https://docs.astro.build/en/guides/content-collections/
- On-demand rendering and adapters: https://docs.astro.build/en/guides/on-demand-rendering/
- Actions: https://docs.astro.build/en/guides/actions/
- Images: https://docs.astro.build/en/guides/images/
- Astro 5 upgrade guide: https://docs.astro.build/en/guides/upgrade-to/v5/
- Testing: https://docs.astro.build/en/guides/testing/
