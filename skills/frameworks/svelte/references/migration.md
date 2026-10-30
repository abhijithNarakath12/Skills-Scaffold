# Svelte 4 to Svelte 5 mapping

Run `npx sv migrate svelte-5` first; it handles most mechanical changes. Review the output for `$:` statements with side effects and for event forwarding.

## Component syntax

| Svelte 4 | Svelte 5 | Notes |
|---|---|---|
| `export let name;` | `let { name } = $props();` | Defaults in destructuring: `{ name = 'x' }` |
| `export let value;` bound by parent with `bind:value` | `let { value = $bindable() } = $props();` | Props are read-only unless `$bindable` |
| `let count = 0;` (reactive top-level) | `let count = $state(0);` | Non-`$state` lets are plain variables |
| `$: doubled = count * 2;` | `let doubled = $derived(count * 2);` | Pure derivations |
| `$: { console.log(count); }` | `$effect(() => { console.log(count); });` | Side effects only |
| `$: if (x) doSomething();` | `$effect(() => { if (x) doSomething(); })` | |
| `on:click={fn}` | `onclick={fn}` | All DOM events are attributes |
| `on:click\|preventDefault={fn}` | `onclick={(e) => { e.preventDefault(); fn(e); }}` | Modifiers removed |
| `on:click` (forwarding) | `let { onclick } = $props();` then `onclick={onclick}` | Or spread `...rest` |
| `createEventDispatcher()` + `dispatch('save', d)` | `let { onsave } = $props();` then `onsave?.(d)` | Callback props |
| `<slot />` | `{@render children?.()}` with `children?: Snippet` | |
| `<slot name="header" />` | `{@render header?.()}` with `header?: Snippet` | Parent passes `{#snippet header()}...{/snippet}` |
| `<slot item={x} />` + `let:item` | `{@render row(x)}` with `row: Snippet<[Item]>` | Parent: `{#snippet row(item)}...{/snippet}` |
| `$$props`, `$$restProps` | `let { a, ...rest } = $props();` | |
| `$$slots.header` | `header` snippet prop is defined or not | |
| `beforeUpdate` / `afterUpdate` | `$effect.pre` / `$effect` | Scope to the state actually read |
| `new App({ target })` | `mount(App, { target })` | `unmount(app)` to destroy |
| `<svelte:component this={C} />` | `<C />` (components are dynamic in runes mode) | |
| `bind:this` | unchanged | |
| `tick()` | unchanged | |

## Stores to runes

| Store pattern | Runes pattern |
|---|---|
| `export const count = writable(0);` in `store.ts` | `export const counter = $state({ value: 0 });` in `store.svelte.ts` (object so mutation is shared) |
| `$count` in component | `counter.value` |
| `count.update(n => n + 1)` | `counter.value += 1` |
| `derived(count, n => n * 2)` | `export function doubled() { return counter.value * 2 }` or a class with `$derived` field |
| `readable(0, set => { ...; return stop })` | `$state` + `$effect` in the consuming component, or a class whose constructor starts the subscription with cleanup via `$effect.root` |
| `get(store)` | just read the value |
| Custom store `{ subscribe, inc }` | class with `$state` fields and methods |

Exporting a `$state` primitive directly (`export let count = $state(0)`) cannot be reassigned by importers; export an object or class instance, or export getter/setter functions.

Stores remain valid for: existing code, library interop (`svelte/store` is not deprecated), and when a store contract (`subscribe`) is required by a third party. `$store` syntax works in runes-mode components.

## Reactivity differences to watch

- `$state` proxies are deep: `obj.nested.x = 1` triggers; in Svelte 4 only assignment to the top-level variable did. Use `$state.raw` to opt out.
- `$derived` is lazy and only recomputes when read after a dependency changed; `$:` ran eagerly before every render.
- `$effect` runs after the DOM updates (like `afterUpdate`) and re-runs when any synchronously read state changes; it does not run during SSR.
- Passing state to a child via props is one-way unless `$bindable`; Svelte 4 allowed binding to any exported prop.
- Props are not deeply reactive from the child's point of view if the parent passes a non-`$state` object.

## SvelteKit 1 to 2 (if also upgrading)

- `throw redirect()` / `throw error()` become bare calls (`redirect(303, '/')`).
- Cookies require an explicit `path` option in `cookies.set`.
- `$app/stores` deprecated for `$app/state` in 2.12+.
- `goto()` to external URLs is disallowed; use `window.location`.
- Run `npx sv migrate sveltekit-2` for the mechanical parts.
