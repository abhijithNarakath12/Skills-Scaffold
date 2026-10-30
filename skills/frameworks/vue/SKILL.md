---
name: vue
description: Build and maintain Vue 3 applications with the Composition API and <script setup>, covering reactivity (ref, reactive, computed, watch), single-file components, props/emits/v-model, composables, Pinia stores, Vue Router, Vite tooling, Vitest with Vue Test Utils, and eslint-plugin-vue. Use when editing .vue files or a project that depends on vue, including Nuxt, Vite and Quasar projects.
---

# Vue

Assumes Vue 3.4+ with `<script setup lang="ts">`, Vite, Pinia and Vue Router 4. The Options API appears only in legacy code; do not introduce it. Vue 2 is end-of-life; if `vue` is `^2`, stop and confirm a migration plan before writing new code.

## When to use

- Creating or changing components, composables, stores, routes, or templates.
- Reactivity questions: why a value does not update, when to use `ref` vs `reactive`, watchers vs computed.
- Forms, lists, transitions, slots, provide/inject, async components.
- Writing component and store tests.
- Nuxt projects: use the `nuxt` skill for routing/server/data fetching and this skill for the component layer.

## Project conventions to detect first

1. Vue minor version in `package.json`: 3.3 adds generic components and `defineOptions`/`defineSlots`; 3.4 adds `defineModel` (stable) and `v-bind` same-name shorthand; 3.5 adds reactive props destructure, `useTemplateRef`, `onWatcherCleanup`, `useId`.
2. Build tool: Vite (`vite.config.ts` with `@vitejs/plugin-vue`), Nuxt, Vue CLI (`vue.config.js`, legacy), Quasar.
3. TypeScript: `vue-tsc` in scripts, `env.d.ts` with `/// <reference types="vite/client" />`, `strict` in `tsconfig`.
4. State: `pinia` (preferred), `vuex` (legacy), or plain composables. Do not add a second store library.
5. Routing: `vue-router` with a manual `routes` array, or file-based via `unplugin-vue-router` (`typed-router.d.ts` present).
6. Component library and styling: Vuetify, PrimeVue, Element Plus, Naive UI, Quasar, shadcn-vue; Tailwind, UnoCSS, SCSS, scoped CSS. Follow what exists.
7. Utilities: `@vueuse/core` (use it before writing a generic composable), `vee-validate` or `@tanstack/vue-form` for forms, `@tanstack/vue-query` for server state, `vue-i18n`.
8. Lint/format: `eslint-plugin-vue` (`flat/recommended` in `eslint.config.*`), `@vue/eslint-config-typescript`, `prettier`.
9. Tests: `vitest.config.ts` (or `test` block in `vite.config.ts`), `@vue/test-utils`, `@testing-library/vue`, `@pinia/testing`, Playwright/Cypress for e2e.

## Core guidance

### Single-file components

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';

interface Props {
  title: string;
  items?: string[];
}
const props = withDefaults(defineProps<Props>(), { items: () => [] });
// Vue 3.5+: const { title, items = [] } = defineProps<Props>();

const emit = defineEmits<{ select: [item: string] }>();
const query = ref('');
const filtered = computed(() => props.items.filter((i) => i.includes(query.value)));
</script>

<template>
  <section>
    <h2>{{ title }}</h2>
    <input v-model="query" :aria-label="`Filter ${title}`" />
    <ul>
      <li v-for="item in filtered" :key="item" @click="emit('select', item)">{{ item }}</li>
    </ul>
  </section>
</template>

<style scoped>
li { cursor: pointer; }
</style>
```

- One component per `.vue` file, `PascalCase` file and component names, multi-word names (`UserCard`, not `Card`) to satisfy `vue/multi-word-component-names`.
- Props are read-only; never mutate them. Emit an event or use `defineModel` for two-way binding.
- `defineModel<string>()` (3.4+) replaces the `modelValue` prop + `update:modelValue` emit pair. Named models: `defineModel<boolean>('open')`.
- `defineExpose({ focus })` to expose methods to parents via template refs; nothing is exposed by default.
- `defineOptions({ inheritAttrs: false })` + `v-bind="$attrs"` when the root element is not where attributes should land, or for multi-root components.
- Typed slots: `defineSlots<{ default(props: { item: T }): any }>()`. Generic components: `<script setup lang="ts" generic="T extends { id: string }">`.
- `<style scoped>` by default; reach into child components with `:deep(.selector)`. CSS Modules via `<style module>` and `$style`.

### Reactivity

- `ref()` for primitives and for values you reassign; `reactive()` for objects you mutate in place. Prefer `ref` everywhere for consistency; `.value` in script, auto-unwrapped in templates.
- Never destructure a `reactive` object or spread it into a plain object: you lose reactivity. Use `toRefs()`/`toRef()` or keep the object.
- `computed` for derived values; it must be pure and synchronous. Writable computed only for v-model proxies.
- `watch(source, cb, { immediate, deep, once })` for side effects on specific sources; `watchEffect` when the dependencies are whatever the callback reads. Watch a getter (`() => props.id`) to watch a prop; watching `props.id` directly passes a value, not a source.
- `shallowRef`/`shallowReactive` for large data structures or third-party class instances; trigger updates with `triggerRef` or by replacing `.value`.
- `toValue()` accepts a ref, getter, or plain value: use it in composable arguments.
- Template refs: `const input = useTemplateRef<HTMLInputElement>('input')` (3.5) or `const input = ref<HTMLInputElement | null>(null)` matched by `ref="input"`.
- Detailed decision table: [references/reactivity.md](references/reactivity.md).

### Templates

- `v-for` always with `:key` bound to a stable id. Never put `v-if` and `v-for` on the same element (v-if wins in Vue 3; wrap with `<template v-for>`).
- `v-if` vs `v-show`: `v-show` for frequent toggles of cheap elements; `v-if` otherwise.
- `v-model` modifiers: `.trim`, `.number`, `.lazy`. Custom modifiers via `defineModel`'s second return value.
- Event handling: `@click.prevent`, `@keydown.enter`, `.stop`, `.self`, `.once`, `.passive`. Use `withDefaults`-style typed handlers instead of inline expressions when the logic exceeds one call.
- Dynamic components: `<component :is="current" />`; keep state with `<KeepAlive>`.
- `<Teleport to="body">` for modals; `<Transition name>` and `<TransitionGroup>` for enter/leave (`tag` required for groups).
- Avoid heavy computation in templates; move to `computed`.

### Composables

```ts
// src/composables/useFetch.ts
import { ref, watchEffect, toValue, type MaybeRefOrGetter } from 'vue';

export function useFetch<T>(url: MaybeRefOrGetter<string>) {
  const data = ref<T | null>(null);
  const error = ref<unknown>(null);
  watchEffect(async (onCleanup) => {
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    data.value = null; error.value = null;
    try {
      data.value = await (await fetch(toValue(url), { signal: controller.signal })).json();
    } catch (e) { if (!controller.signal.aborted) error.value = e; }
  });
  return { data, error };
}
```

- Name `useX`, keep in `src/composables/`, accept `MaybeRefOrGetter` inputs, return an object of refs (destructurable).
- Register lifecycle hooks (`onMounted`, `onUnmounted`, `onBeforeUnmount`) synchronously inside `setup`/composables, never after an `await`.
- Check `@vueuse/core` first (`useLocalStorage`, `useDebounceFn`, `useIntersectionObserver`, `useEventListener`, `useMediaQuery`, `useFetch`).

### Pinia

```ts
// src/stores/cart.ts
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export const useCartStore = defineStore('cart', () => {
  const items = ref<CartItem[]>([]);
  const total = computed(() => items.value.reduce((s, i) => s + i.price * i.qty, 0));
  function add(item: CartItem) { items.value.push(item); }
  async function checkout() { await api.checkout(items.value); items.value = []; }
  return { items, total, add, checkout };
});
```

- Use setup stores (function syntax). Install with `app.use(createPinia())` in `main.ts`.
- In components: `const cart = useCartStore(); const { items, total } = storeToRefs(cart);` (actions can be destructured directly). Plain destructuring of state breaks reactivity.
- Stores for state shared across routes/components; local `ref`s for component-local state. Server data can live in `@tanstack/vue-query` instead.
- Call `useStore()` inside `setup`, composables, or router guards; outside components pass the pinia instance or call after `app.use(pinia)`.

### Vue Router

```ts
// src/router/index.ts
import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', component: () => import('@/views/HomeView.vue') },
    { path: '/users/:id', name: 'user', component: () => import('@/views/UserView.vue'), props: true },
    { path: '/:pathMatch(.*)*', component: () => import('@/views/NotFound.vue') },
  ],
});
router.beforeEach(async (to) => {
  if (to.meta.requiresAuth && !useAuthStore().isLoggedIn) return { name: 'login', query: { redirect: to.fullPath } };
});
```

- Lazy-load route components with dynamic imports. `props: true` passes params as props so views are testable without the router.
- In components use `useRoute()` (reactive) and `useRouter()`; navigate with `router.push({ name, params })`. `<RouterLink :to>` renders anchors; `<RouterView>` with `v-slot` for transitions/KeepAlive.
- Type `meta` by augmenting `RouteMeta` in a `.d.ts`.
- Guards return `true`/`undefined` to continue, `false` to cancel, or a route location to redirect; do not call `next()` in new code.

### Performance

- `v-once` / `v-memo` for static or rarely changing expensive subtrees.
- Virtualize long lists (`@tanstack/vue-virtual`, `vue-virtual-scroller`).
- `defineAsyncComponent(() => import('./Heavy.vue'))` for code-splitting non-route components.
- `shallowRef` for big immutable payloads; avoid deep watchers on large objects.
- Profile with Vue Devtools (component render timings) before optimising.

## Common tasks

### Create a component

1. `src/components/<Name>.vue` (or the feature folder), `<script setup lang="ts">`, typed `defineProps`/`defineEmits`, scoped styles.
2. Register nothing globally; import where used (or rely on `unplugin-vue-components` if present).
3. Test in `src/components/__tests__/<Name>.spec.ts` or next to it per the repo convention.

### Add a page/route

1. View in `src/views/<Name>View.vue`.
2. Route entry with a lazy import, `name`, and `meta` (auth, title).
3. Data loading: fetch in `onMounted` or a composable keyed on `route.params`, or use `@tanstack/vue-query`; show loading and error states.
4. With `unplugin-vue-router`, add `src/pages/<path>.vue` instead and let typegen run.

### Add global state

1. New setup store in `src/stores/<name>.ts`.
2. Use `storeToRefs` in components; actions for all mutations that involve async work.
3. Test the store with `setActivePinia(createPinia())` in `beforeEach`.

### Build a form

1. `v-model` on inputs bound to a `reactive` form object or individual refs.
2. Validation with `vee-validate` + `zod`/`yup` (`useForm`, `useField`) if present; otherwise a `computed` errors map.
3. Disable submit while pending; emit `submit` with the validated payload; parent performs the API call or store action.

### Write a component test

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import Counter from '../Counter.vue';

describe('Counter', () => {
  it('increments', async () => {
    const wrapper = mount(Counter, { props: { start: 1 } });
    await wrapper.get('button').trigger('click');
    expect(wrapper.text()).toContain('2');
    expect(wrapper.emitted('change')?.[0]).toEqual([2]);
  });
});
```

- Vitest needs `environment: 'jsdom'` (or `happy-dom`) and `@vitejs/plugin-vue` in the config.
- With Pinia: `mount(Comp, { global: { plugins: [createTestingPinia({ stubActions: false })] } })`.
- With the router: provide a real router (`createRouter` + `createMemoryHistory`) or `global.mocks.$route`; prefer `props: true` views so most tests need neither.
- `@testing-library/vue` (`render`, `screen.getByRole`) when the repo uses it; query by role/text, not by class.

## Pitfalls

- Destructuring `reactive()` or a store without `storeToRefs`: values freeze.
- Forgetting `.value` in script (`if (loading)` instead of `if (loading.value)`); TypeScript catches most cases, `watch(count)` vs `watch(() => count.value)` it does not.
- `watch(props.id, ...)` watches a primitive snapshot; use `() => props.id`.
- Mutating props (`props.items.push(x)`); copy or emit instead.
- Registering `onMounted` after `await` inside `setup` (warns, never runs).
- Using array index as `:key` for lists that reorder, or omitting `:key` on `<template v-for>` children.
- Expecting `reactive` to track newly added properties on a `Map`/`Set` without using their methods, or replacing `reactive` objects wholesale (`state = {...}` breaks the proxy; use `Object.assign` or a `ref`).
- `v-html` with user content (XSS); sanitise first.
- Heavy work in `computed` with side effects; computed must be pure.
- Global component registration by convention when the project uses explicit imports (breaks tree-shaking and type inference).
- Mixing Options API `this.` patterns into `<script setup>` (there is no `this`).

## Verification

```bash
cat package.json | jq .scripts
npm run lint                      # eslint with eslint-plugin-vue
npx vue-tsc --noEmit              # type-check .vue files (plain tsc skips templates)
npx vitest run                    # unit/component tests
npm run build                     # vite build; surfaces unresolved imports and template compile errors
npx playwright test               # if e2e exists
```

## References

- [references/reactivity.md](references/reactivity.md): ref vs reactive vs computed vs watch, and the cases that silently lose reactivity.
- Vue docs: https://vuejs.org/guide/introduction.html
- Composition API FAQ and style guide: https://vuejs.org/guide/extras/composition-api-faq.html, https://vuejs.org/style-guide/
- Pinia: https://pinia.vuejs.org/core-concepts/
- Vue Router: https://router.vuejs.org/guide/
- Vue Test Utils: https://test-utils.vuejs.org/guide/
- eslint-plugin-vue rules: https://eslint.vuejs.org/rules/
