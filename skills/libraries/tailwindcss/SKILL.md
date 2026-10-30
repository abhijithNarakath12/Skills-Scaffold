---
name: tailwindcss
description: Use Tailwind CSS v4 (with v3 notes) correctly in any frontend project - CSS-first @theme configuration vs tailwind.config.js, utility conventions, responsive and dark variants, component extraction, class sorting with prettier-plugin-tailwindcss, and conditional classes with clsx/cva/tailwind-merge. Load when a project depends on tailwindcss, contains tailwind.config.* or @import "tailwindcss", or when styling with utility classes.
---

# Tailwind CSS

Assumes Tailwind CSS v4 (CSS-first configuration). v3 differences are called out explicitly; detect the version before changing configuration.

## When to use

- Styling components with utility classes, adding design tokens (colors, spacing, fonts), or theming.
- Setting up or migrating Tailwind configuration, dark mode, or responsive breakpoints.
- Building reusable component variants (`cva`), merging class props (`tailwind-merge`), or fixing class-ordering lint noise.
- Pair with the framework skill (react, nextjs, vue, svelte) for component structure.

## Project conventions to detect first

1. Version: `tailwindcss` in `package.json`. `^4` means CSS-first config; `^3` means `tailwind.config.{js,ts,cjs}` + PostCSS/`content` globs.
2. Entry CSS file: v4 has `@import "tailwindcss";` (often `src/app.css`, `app/globals.css`, `src/index.css`); v3 has `@tailwind base; @tailwind components; @tailwind utilities;`.
3. Integration: `@tailwindcss/vite` plugin in `vite.config.*` (preferred for Vite), `@tailwindcss/postcss` in `postcss.config.*` (Next.js, others), or the standalone CLI `@tailwindcss/cli`. v3 uses the `tailwindcss` PostCSS plugin plus `autoprefixer`.
4. Theme customisation: `@theme { ... }` blocks in CSS (v4) or `theme.extend` in the config (v3). Reuse existing tokens; do not hardcode hex values when a token exists.
5. Class helpers: `clsx`/`classnames`, `class-variance-authority` (`cva`), `tailwind-merge` (`twMerge`), or the shadcn/ui `cn()` helper in `lib/utils.ts`. Use the existing one.
6. Component library: shadcn/ui (`components.json`), daisyUI, Flowbite, Headless UI, Radix. Follow its conventions for variants and tokens.
7. Formatting: `prettier-plugin-tailwindcss` in `.prettierrc` sorts classes; `eslint-plugin-tailwindcss` or `eslint-plugin-better-tailwindcss` may be present.
8. Dark mode strategy: v4 defaults to `prefers-color-scheme`; a `@custom-variant dark (&:where(.dark, .dark *));` line means class-based toggling. v3: `darkMode: 'class'` or `'media'` in config.

## Core guidance

### Configuration (v4)

```css
/* src/app.css */
@import "tailwindcss";

@theme {
  --color-brand-500: oklch(0.65 0.2 250);
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --breakpoint-3xl: 120rem;
  --spacing: 0.25rem; /* base of the spacing scale */
}

/* class-based dark mode instead of media query */
@custom-variant dark (&:where(.dark, .dark *));

/* scan files Tailwind cannot see automatically (monorepo packages, node_modules UI kits) */
@source "../node_modules/@acme/ui";

/* project-level reusable utility */
@utility scrollbar-none {
  scrollbar-width: none;
}
```

- `@theme` variables become both utilities (`bg-brand-500`, `font-sans`, `3xl:`) and CSS variables (`var(--color-brand-500)`). Use `@theme inline` when the value references another variable and you want the raw reference emitted.
- Override a whole namespace with `--color-*: initial;` before defining your own palette.
- Content detection is automatic in v4 (respects `.gitignore`); add `@source` only for paths outside the project root or ignored files. `@source not "..."` excludes.
- Legacy JS config can still be loaded with `@config "../tailwind.config.js";` during migration, but prefer finishing the migration.
- Plugins: `@plugin "@tailwindcss/typography";` in CSS (v4) instead of the `plugins` array.

### Configuration (v3)

```js
// tailwind.config.ts
import type { Config } from 'tailwindcss';
export default {
  content: ['./index.html', './src/**/*.{ts,tsx,vue,svelte}'],
  darkMode: 'class',
  theme: { extend: { colors: { brand: { 500: '#3b82f6' } } } },
  plugins: [],
} satisfies Config;
```

- Missing `content` globs are the top cause of "class has no effect". Every file that contains class names must match a glob.
- Extend, never replace, `theme` unless intentionally dropping defaults.

### Writing utilities

- Mobile-first: unprefixed classes apply to all sizes; `md:` applies at `min-width` of that breakpoint. Use `max-md:` (v3.2+/v4) for upper-bounded ranges.
- Stack variants in the order Tailwind sorts them: `hover:focus:`, `dark:md:hover:bg-x`. Order does not change behaviour but keep it consistent for readability.
- Arbitrary values: `w-[37rem]`, `grid-cols-[1fr_auto]`, `text-[var(--x)]`, `[mask-type:luminance]`. Reach for them only when no token fits; add a token to `@theme` if the value repeats.
- State on parent/sibling: `group` + `group-hover:`, `peer` + `peer-checked:`; named groups `group/card` + `group-hover/card:`. `has-[:checked]:` for parent styling based on descendants (v3.4+/v4).
- Data attributes: `data-[state=open]:rotate-180` (works with Radix/shadcn), `aria-[expanded=true]:`. v4 also supports bare `data-open:` for boolean attributes.
- Container queries are built in to v4: `@container` on the parent, `@md:flex` on children (v3 needs `@tailwindcss/container-queries`).
- Prefer `gap-*` over margins between flex/grid children; `space-x-*` and `divide-*` are still available but `gap` is more robust.
- `size-10` sets both width and height (v3.4+/v4).
- Do not build class names dynamically (`bg-${color}-500`): the scanner cannot see them. Map props to complete literal strings instead.

### Component extraction

- First choice: a framework component (`<Button variant="primary">`) that owns the class string. Second: `cva` for variant tables. Last: `@apply` inside a CSS class, only for third-party markup you cannot edit or tiny base styles.
- In v4, `@apply` inside separately imported CSS files needs `@reference "../app.css";` at the top of that file (CSS Modules, Vue `<style>`, Svelte `<style>`).

```ts
// components/ui/button.tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { twMerge } from 'tailwind-merge';
import { clsx, type ClassValue } from 'clsx';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const button = cva(
  'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-brand-500 text-white hover:bg-brand-600',
        ghost: 'hover:bg-gray-100 dark:hover:bg-gray-800',
      },
      size: { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

interface ButtonProps extends React.ComponentProps<'button'>, VariantProps<typeof button> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(button({ variant, size }), className)} {...props} />;
}
```

- `twMerge` resolves conflicts (`p-2` vs `p-4`, `bg-red-500` vs `bg-blue-500`) so a `className` prop can override defaults; plain string concatenation cannot. If the project has custom theme namespaces that collide (e.g. `text-brand` vs `text-lg`), configure `extendTailwindMerge`.
- `clsx` handles conditionals (`clsx('base', isActive && 'bg-x', { hidden: !open })`).

### Class ordering

- Install `prettier-plugin-tailwindcss` and add it to `plugins` in the Prettier config; it must be last in the `plugins` array. For v4 set `tailwindStylesheet: "./src/app.css"`; for v3 set `tailwindConfig` if the config is not at the root.
- Tell the plugin about helper functions so their arguments get sorted: `tailwindFunctions: ["clsx", "cn", "cva", "tw"]`, and `tailwindAttributes: ["className", "classList"]` for non-standard props.
- Do not hand-sort; run `prettier --write`.

### Dark mode and theming

- Define semantic tokens once (`--color-background`, `--color-foreground`) and switch their values under `.dark { ... }` using plain CSS variables; then utilities like `bg-background` work in both themes without `dark:` on every element. shadcn/ui uses this pattern.
- Use `dark:` for one-off differences only.
- Toggle class-based dark mode by adding `dark` to `<html>`; persist the choice and apply it before first paint (inline script) to avoid flashes.

## Common tasks

### Add Tailwind v4 to a Vite project

```bash
npm install tailwindcss @tailwindcss/vite
```

1. `vite.config.ts`: `import tailwindcss from '@tailwindcss/vite'` and add `tailwindcss()` to `plugins`.
2. Create/replace the entry CSS with `@import "tailwindcss";` and import it in `main.tsx`.
3. No `tailwind.config.js`, no PostCSS config, no `content` array required.

### Add Tailwind v4 to Next.js (PostCSS)

```bash
npm install tailwindcss @tailwindcss/postcss postcss
```

`postcss.config.mjs`: `export default { plugins: { '@tailwindcss/postcss': {} } };` then `@import "tailwindcss";` in `app/globals.css`.

### Migrate v3 to v4

1. `npx @tailwindcss/upgrade` on a clean git branch (requires Node 20+). It rewrites the CSS entry, moves `theme.extend` into `@theme`, renames utilities, and updates the PostCSS/Vite setup.
2. Review the diff for: renamed utilities (`shadow-sm` -> `shadow-xs`, `shadow` -> `shadow-sm`, `rounded-sm` -> `rounded-xs`, `rounded` -> `rounded-sm`, `outline-none` -> `outline-hidden`, `ring` default width 3px -> 1px, `bg-opacity-*` -> `bg-black/50`), `border` default color now `currentColor`, and removed `@tailwind` directives.
3. Replace `darkMode: 'class'` with `@custom-variant dark (&:where(.dark, .dark *));`.
4. Replace `plugins: [typography]` with `@plugin "@tailwindcss/typography";`.
5. Browser support: v4 needs Safari 16.4+, Chrome 111+, Firefox 128+. Stay on v3.4 if older browsers are required.

### Add a design token

- v4: add `--color-accent: ...;` (or `--spacing-18`, `--font-display`, `--radius-card`) inside `@theme`; use `bg-accent`, `p-18`, `font-display`, `rounded-card`.
- v3: `theme.extend.colors.accent` in the config.
- Grep for the hardcoded value and replace with the new utility.

### Build a responsive layout

```html
<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
  <article class="rounded-lg border border-gray-200 p-4 dark:border-gray-800">...</article>
</div>
```

Use `container` + `mx-auto px-4` or a `max-w-*` wrapper; in v4 `container` has no `center`/`padding` config, so add those utilities or an `@utility container { ... }` override.

### Style third-party or markdown HTML

Use `@tailwindcss/typography` and `class="prose dark:prose-invert"`, or target children with arbitrary variants: `[&_a]:underline`, `[&>li]:mt-2`, `*:rounded-md` (direct-children variant, v3.4+/v4).

## Pitfalls

- Dynamic class string construction; classes never make it into the build.
- v3: new source directories not added to `content`; v4: files ignored by `.gitignore` (generated code) not added with `@source`.
- Multiple `tailwindcss` versions in a monorepo producing duplicate or conflicting base styles.
- `@apply` of a class that uses variants like `hover:` works, but `@apply` of custom classes defined in other files fails without `@reference` (v4).
- Passing `className` through without `twMerge`, so caller overrides lose to the component defaults.
- Preflight resets (`h1` margins, `button` styles, `img` display block) surprising designers: scope expectations, do not disable Preflight wholesale.
- Mixing `space-y-*` with absolutely positioned or hidden children (it uses sibling selectors); use `gap` on a flex column.
- `dark:` utilities applied everywhere instead of semantic CSS variables; the stylesheet becomes unmaintainable.
- Using `!important` via `!p-4` (v3) / `p-4!` (v4) to fight specificity instead of fixing the cascade or `twMerge` order.
- Running the upgrade tool on a dirty working tree; it rewrites many files.

## Verification

```bash
npx prettier --check .                 # class order (with prettier-plugin-tailwindcss)
npm run lint                           # eslint-plugin-tailwindcss if configured
npm run build                          # production CSS; confirm expected utilities are emitted
npx @tailwindcss/cli -i src/app.css -o /tmp/out.css && grep -c "bg-brand-500" /tmp/out.css   # v4 standalone check
```

Visually verify in the browser at mobile and desktop widths and in both colour schemes.

## References

- [references/v3-vs-v4.md](references/v3-vs-v4.md): side-by-side of config and utility differences.
- Tailwind v4 docs: https://tailwindcss.com/docs
- Upgrade guide: https://tailwindcss.com/docs/upgrade-guide
- Theme variables: https://tailwindcss.com/docs/theme
- Prettier plugin: https://github.com/tailwindlabs/prettier-plugin-tailwindcss
- cva: https://cva.style/docs ; tailwind-merge: https://github.com/dcastil/tailwind-merge
