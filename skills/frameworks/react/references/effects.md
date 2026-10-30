# You might not need an effect

Condensed from the React docs. Reach for `useEffect` only to synchronize with something outside React.

| Situation | Do not | Do |
|---|---|---|
| Value derived from props/state | `useEffect(() => setFull(first + ' ' + last))` | compute during render: `const full = first + ' ' + last` |
| Expensive derived value | effect + state | `useMemo(() => compute(items), [items])` |
| Reset state when a prop changes | effect watching the prop | render with `key={userId}` so the subtree remounts |
| Adjust some state when a prop changes | effect | compute during render, or store the previous prop and update state inline (rare) |
| Notify parent of a change | effect that calls `onChange` | call `onChange` in the event handler that caused the change |
| Send a request on user action | effect keyed on a "submitted" flag | do it in the event handler |
| Initialize the app once | effect in a component | module-level code or a guard with a top-level flag |
| Subscribe to an external store | manual effect | `useSyncExternalStore` |
| Fetch data for rendering | effect + state | data library (TanStack Query, SWR), framework loader, or RSC; if an effect is unavoidable, cancel with `AbortController` and ignore stale results |

Legitimate effect uses: subscriptions (WebSocket, event listeners), timers, imperative DOM libraries (charts, maps), analytics on mount, focus management, and syncing with browser APIs (localStorage, title, media).

Every such effect:

1. Lists all reactive dependencies honestly.
2. Returns a cleanup that undoes the subscription/timer.
3. Tolerates running twice in development (Strict Mode).
