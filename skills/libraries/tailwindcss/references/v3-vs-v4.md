# Tailwind v3 vs v4 quick reference

| Concern | v3 | v4 |
|---|---|---|
| Entry CSS | `@tailwind base; @tailwind components; @tailwind utilities;` | `@import "tailwindcss";` |
| Config | `tailwind.config.{js,ts}` with `content`, `theme`, `plugins` | `@theme { --color-x: ... }`, `@plugin`, `@source` in CSS; `@config` to load legacy JS config |
| Content scanning | explicit `content` globs | automatic (respects `.gitignore`); `@source` for extra paths |
| Build integration | `tailwindcss` + `autoprefixer` PostCSS plugins | `@tailwindcss/vite` or `@tailwindcss/postcss` (autoprefixer and imports built in) |
| Dark mode | `darkMode: 'class' \| 'media'` | media by default; `@custom-variant dark (&:where(.dark, .dark *));` for class |
| Custom utilities | `addUtilities` in a plugin or `@layer utilities { .x {} }` | `@utility x { ... }` (gets variant support automatically) |
| Custom variants | `addVariant` in a plugin | `@custom-variant name (selector);` |
| Theme values in JS | `resolveConfig(tailwindConfig)` | read CSS variables: `getComputedStyle(document.documentElement).getPropertyValue('--color-brand-500')` |
| Container queries | `@tailwindcss/container-queries` plugin | built in (`@container`, `@md:`) |
| Important modifier | `!p-4` | `p-4!` |
| Opacity utilities | `bg-opacity-50` (deprecated since 3.1) | removed; use `bg-black/50` |
| Default border color | `gray-200` | `currentColor` |
| Default ring | 3px blue | 1px `currentColor` (`ring-3` for the old look) |
| Shadows / radii | `shadow-sm`, `shadow`, `rounded-sm`, `rounded` | shifted down one step: `shadow-xs`, `shadow-sm`, `rounded-xs`, `rounded-sm` |
| `outline-none` | removes outline | `outline-hidden` (keeps forced-colors outline); `outline-none` now sets `outline-style: none` |
| Space between | `space-x-*` uses `> :not([hidden]) ~ :not([hidden])` | uses `:not(:last-child)` selector; prefer `gap` |
| Preflight placeholder color | `gray-400` | current color at 50% opacity |
| Hover on touch | always applies | `hover:` only applies when the device supports hover (`@media (hover: hover)`) |
| Prefix | `prefix: 'tw-'` -> `tw-flex` | `@import "tailwindcss" prefix(tw);` -> `tw:flex` |
| Browser floor | any modern browser | Safari 16.4+, Chrome 111+, Firefox 128+ |

Run `npx @tailwindcss/upgrade` to apply most of these automatically, then review the diff.
