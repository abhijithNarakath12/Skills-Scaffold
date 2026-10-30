---
name: react
description: Build and maintain React 18/19 applications with function components, hooks, TypeScript, state and data-fetching patterns, performance tuning, accessibility and testing (React Testing Library, Vitest/Jest). Use when working in .jsx/.tsx files or a project that depends on react and react-dom, including Next.js, Remix, Vite and React Native projects.
---

# React

Assumes React 18 or 19 with function components and hooks. Class components appear only in legacy code; do not introduce new ones.

## When to use

- Creating or changing components, hooks, context, or client state.
- Fetching data in React, handling forms, routing, or performance issues (re-renders, large lists).
- Writing component tests.
- Meta-frameworks (Next.js, Remix, TanStack Start) have their own skills for routing and server features; use this skill for the component layer.

## Project conventions to detect first

1. React version in `package.json` (19 enables `use`, Actions, `ref` as prop, `useActionState`, `useOptimistic`; 18 does not).
2. Framework: Next.js (`next`), Remix/React Router v7 (`@remix-run/*`, `react-router`), Vite (`vite.config.*`), CRA (`react-scripts`), Expo/React Native.
3. State and data libraries: `@tanstack/react-query`, `swr`, `zustand`, `jotai`, `redux`/`@reduxjs/toolkit`, `mobx`, `xstate`, `apollo`, `urql`. Use what exists; do not add a second state library.
4. Styling: Tailwind, CSS Modules, styled-components/emotion, vanilla-extract, a UI kit (shadcn/ui, MUI, Chakra, Mantine, Radix). Follow the existing approach.
5. Forms: `react-hook-form`, `formik`, or plain controlled inputs; validation via `zod`/`yup`.
6. Component conventions: folder-per-component vs flat, `index.ts` barrels, naming (`Button.tsx`), colocated tests and stories, Storybook presence.
7. Lint: `eslint-plugin-react-hooks` must be on; respect `react/jsx-*` rules in config.

## Core guidance

### Components

- One component per file, named export matching the file name, props typed with an `interface Props` (or `ComponentProps<'button'> & {...}` when wrapping DOM elements).
- Keep components small and pure: derive values from props/state during render instead of syncing them into state with effects.
- Children and composition over configuration props. Prefer `children`, render props or slots to boolean prop explosions.
- Use `key` that identifies the item (ids), never array index for lists that reorder or filter.
- Conditional rendering: `cond ? <A/> : null`; avoid `cond && <A/>` when `cond` can be `0` or `''`.
- Forward refs: in React 19 `ref` is a normal prop; in 18 use `forwardRef`.

### Hooks

- Follow the Rules of Hooks (top level, same order). The linter enforces this; never disable it.
- `useState` for local UI state; lift state only as far as needed. Use a reducer (`useReducer`) when several state fields change together.
- `useEffect` is for synchronizing with external systems (subscriptions, DOM APIs, network when no data library exists). It is **not** for deriving state, responding to prop changes, or triggering parent callbacks. See [references/effects.md](references/effects.md).
- Every effect returns a cleanup when it subscribes, starts a timer, or begins a request (`AbortController`).
- Memoization (`useMemo`, `useCallback`, `React.memo`) is an optimization, applied after measuring with the React DevTools Profiler, or when passing callbacks to memoized children or effect dependencies. React Compiler (React 19 ecosystem) may make manual memoization unnecessary; check if it is enabled (`babel-plugin-react-compiler`).
- Custom hooks encapsulate behaviour, named `useX`, return stable shapes (object or tuple), and live in `hooks/` or next to their feature.
- `useRef` for mutable values that do not drive rendering and for DOM nodes.
- `useId` for accessible label/input ids; never `Math.random()` in render.

### State and data

- Server data belongs in a server-state library (TanStack Query/SWR/RSC) with caching and invalidation, not in `useEffect` + `useState`.
- Global client state: context for low-frequency values (theme, auth user); a store (zustand/jotai/redux) for frequently changing shared state. Split contexts to avoid re-rendering the whole tree.
- Keep URL state in the URL (search params) for anything shareable or back-button relevant.
- Forms: controlled inputs for small forms; `react-hook-form` for large ones. Validate with the same schema used on the server when possible.
- Immutable updates: spread or `structuredClone`; never mutate state objects or arrays in place.

### Performance

1. Measure first (React DevTools Profiler, `why-did-you-render` in dev).
2. Fix structure before memoizing: move state down, lift expensive children up as `children`, split contexts.
3. Virtualize long lists (`@tanstack/react-virtual`, `react-window`).
4. Code-split routes and heavy components with `React.lazy` + `Suspense`.
5. Use `useTransition`/`useDeferredValue` for expensive updates triggered by typing.
6. Avoid creating new objects/arrays/functions as props to memoized children on every render.

### Accessibility

- Semantic elements first (`button`, `nav`, `ul`, `label for`); ARIA only to fill gaps.
- Keyboard: every interactive element reachable and operable; manage focus on dialogs and route changes.
- Images need `alt`; icon-only buttons need `aria-label`.
- Run `eslint-plugin-jsx-a11y` if present; test with `@testing-library/jest-dom` role queries (`getByRole`) which fail when semantics are wrong.

### Error and loading states

- Wrap feature boundaries in error boundaries (`react-error-boundary` or a class boundary) and provide retry.
- Use `Suspense` for data/lazy loading when the data layer supports it; otherwise explicit `status` unions.

## Common tasks

### Create a component

1. `src/components/<Name>/<Name>.tsx` (or the repo's layout) with typed props and a named export.
2. Styles per the project's approach; no inline style objects unless dynamic.
3. Test in `<Name>.test.tsx`: render, query by role/text, interact with `userEvent`, assert visible outcome.
4. Story in `<Name>.stories.tsx` if Storybook exists.

### Fetch data

- With TanStack Query: `useQuery({ queryKey: ['items', id], queryFn })`, mutations with `useMutation` + `invalidateQueries`.
- With RSC (Next.js App Router): fetch in server components, pass data as props; client components only for interactivity.
- Without a library: custom hook using `useEffect` with `AbortController`, and a `status` union; consider adding TanStack Query instead.

### Add a form

1. Define a schema (zod) and infer the type.
2. `react-hook-form` with `zodResolver`, or controlled inputs for tiny forms.
3. Show inline errors tied to inputs via `aria-describedby`; disable submit while pending; handle server errors.

### Debug a re-render problem

1. Profile; identify the component rendering too often and why (prop identity, context change, parent render).
2. Apply the structural fixes above before `memo`/`useMemo`.

### Write a test

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Counter } from './Counter';

it('increments', async () => {
  render(<Counter />);
  await userEvent.click(screen.getByRole('button', { name: /increment/i }));
  expect(screen.getByText('Count: 1')).toBeInTheDocument();
});
```

Mock network with `msw`, not by mocking the data library. Avoid testing implementation details (state values, internal functions).

## Pitfalls

- Setting state in an effect to mirror props (derive instead, or use `key` to reset).
- Missing effect dependencies silenced with eslint-disable; fix the effect instead.
- Fetching in effects without cancellation leads to race conditions and state updates after unmount.
- Index keys in dynamic lists.
- Giant context values causing whole-app re-renders.
- Defining components inside other components (remounts on every render).
- Async functions passed directly to `useEffect` (return a promise, not cleanup).
- `useLayoutEffect` on the server (warns in SSR); gate it or use `useEffect`.
- Stale closures in intervals and event listeners; use refs or functional state updates.

## Verification

```bash
npm run lint            # eslint with react-hooks and jsx-a11y
npx tsc --noEmit        # if TypeScript
npm test                # vitest/jest + testing-library
npm run build           # vite/next build catches SSR and import errors
```

## References

- [references/effects.md](references/effects.md): when you do and do not need an effect.
- React docs: https://react.dev/learn
- React 19 release notes: https://react.dev/blog/2024/12/05/react-19
- Testing Library guiding principles: https://testing-library.com/docs/guiding-principles/
