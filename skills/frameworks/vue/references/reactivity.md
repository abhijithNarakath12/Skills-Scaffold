# Vue 3 reactivity decisions

## Which primitive

| Need | Use | Notes |
|---|---|---|
| Single value, may be reassigned | `ref(0)` | `.value` in script; unwrapped in templates and when nested in `reactive` |
| Object mutated in place, never replaced | `reactive({})` | Cannot be destructured or reassigned; prefer `ref` unless mutation-heavy |
| Derived read-only value | `computed(() => ...)` | Cached by dependencies; must be pure |
| Two-way derived value (v-model proxy) | `computed({ get, set })` | Rare; used for wrapping a prop in a local model |
| Side effect on specific change | `watch(src, cb)` | `src` is a ref, getter, reactive object, or array of those |
| Side effect on whatever is read | `watchEffect(cb)` | Runs immediately; re-runs when any read dependency changes |
| Large or external object, replace wholesale | `shallowRef(value)` | Only `.value` assignment triggers; use for big lists, class instances, Three.js/Map objects |
| Expose reactive props from a reactive object | `toRefs(obj)` / `toRef(obj, 'key')` | Keeps the link to the source |
| Accept ref/getter/value in a composable | `MaybeRefOrGetter<T>` + `toValue()` | Standard composable input contract |
| Reset a watcher's previous async work | `watch(src, (v, old, onCleanup) => ...)` or `onWatcherCleanup()` (3.5) | Abort requests, clear timers |

## Watch forms

```ts
watch(count, (next, prev) => {});                 // ref
watch(() => props.id, (id) => {}, { immediate: true }); // prop or any getter
watch([a, b], ([a, b]) => {});                    // several sources
watch(state, cb, { deep: true });                 // reactive object is deep by default; explicit deep for refs of objects
watch(src, cb, { once: true });                   // 3.4+
watch(src, cb, { flush: 'post' });                // run after DOM update (for DOM reads)
```

`watch` is lazy (runs on change), `watchEffect` is eager. Both return a `stop()` handle and stop automatically when the component unmounts if created synchronously in `setup`.

## Ways reactivity is silently lost

| Code | Why | Fix |
|---|---|---|
| `const { items } = reactive(state)` | Destructuring copies the raw value | `toRefs(state)` or keep `state.items` |
| `const { count } = useCounterStore()` | Same, Pinia state is reactive | `storeToRefs(store)` |
| `let x = ref(0); x = ref(1)` | Rebinding the variable, not `.value` | `x.value = 1` |
| `state = { ...state, a: 1 }` where `state` is `reactive` | Replaces the proxy | `Object.assign(state, {...})` or use a `ref` |
| `watch(props.id, cb)` | Passes a primitive snapshot | `watch(() => props.id, cb)` |
| `const list = shallowRef([]); list.value.push(x)` | Shallow refs ignore nested mutation | `list.value = [...list.value, x]` or `triggerRef(list)` |
| `const el = ref(null)` used before mount | Template refs populate after mount | Read in `onMounted` or a `watch` on the ref |
| `setInterval(() => count++)` where `count` is a plain `let` | Not reactive at all | Make it a `ref` |
| Spreading reactive props into a child: `v-bind="{ ...props }"` | Spread evaluates once per render, usually fine, but loses `toRef` links in script | Pass `props` or individual bindings |

## Reactive props destructure (3.5+)

```ts
const { size = 'md', label } = defineProps<{ size?: 'sm' | 'md'; label: string }>();
watch(() => size, ...); // must wrap in a getter; `watch(size, ...)` warns
```

The compiler rewrites `size` to `props.size`, so it stays reactive in the template and in computed/watch getters, but passing `size` to a function passes the current value.

## Debugging

- `isRef(x)`, `isReactive(x)`, `isProxy(x)` and `toRaw(x)` in a console or test.
- `onRenderTracked`/`onRenderTriggered` (dev only) print why a component re-rendered.
- Vue Devtools shows component state and Pinia stores; edit values there to confirm bindings.
