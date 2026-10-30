---
name: vitest
description: Write, organize and run tests with Vitest 2/3 in TypeScript and JavaScript projects. Covers vitest.config, test file organization, mocking with vi.mock/vi.fn/vi.spyOn, fake timers, snapshot discipline, coverage, workspaces/projects, browser mode and migrating from Jest. Use when a project depends on vitest or has vitest.config.* / vite.config.* with a test block, or when asked to add or fix unit tests in a Vite-based project.
---

# Vitest

Assumes Vitest 2.x or 3.x with Vite 5/6, ESM-first projects, and TypeScript. Check the installed version with `npx vitest --version`; the 3.x `projects` option replaced the 2.x `vitest.workspace` file.

## When to use

- Adding, fixing or refactoring `*.test.ts` / `*.spec.ts` files run by Vitest.
- Configuring `vitest.config.ts` (environment, coverage, setup files, aliases, projects).
- Mocking modules, timers, network or globals in tests; diagnosing flaky or slow tests.

## Project conventions to detect first

1. Config file: `vitest.config.ts`, `vite.config.ts` with `test: {}`, or `vitest.workspace.ts` (2.x). Note `environment` (`node`, `jsdom`, `happy-dom`), `globals`, `setupFiles`, `include`, `alias`, `coverage.provider`.
2. Test placement: co-located `src/foo.test.ts` vs `tests/` or `__tests__/`; naming `.test` vs `.spec`.
3. Style: `globals: true` (bare `describe`) vs explicit `import { describe, it, expect } from 'vitest'`; `it` vs `test`; use of `@testing-library/*`, `msw`, `supertest`.
4. Scripts: `package.json` `test`, `test:watch`, `test:coverage`, `test:ui`; whether CI passes `--run`/`--reporter`.
5. TypeScript: `types: ["vitest/globals"]` in tsconfig when `globals: true`; `vitest/importMeta` for `import.meta.vitest`.

## Core guidance

### Configuration

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',              // 'jsdom' or 'happy-dom' for DOM code; per-file: // @vitest-environment jsdom
    include: ['src/**/*.{test,spec}.ts'],
    setupFiles: ['./test/setup.ts'],
    restoreMocks: true,               // vi.restoreAllMocks() after each test
    clearMocks: true,
    coverage: {
      provider: 'v8',                 // or 'istanbul'
      reporter: ['text', 'lcov'],
      include: ['src/**'],
      thresholds: { lines: 80, branches: 70 },
    },
  },
});
```

- Use `mergeConfig(viteConfig, defineConfig({ test: {...} }))` when the app already has a `vite.config.ts` and you want a separate test config.
- Keep `environment: 'node'` as default; switch to DOM per file with `// @vitest-environment jsdom` at the top or `environmentMatchGlobs`/projects.
- `restoreMocks: true` avoids leaking `vi.spyOn` across tests.

### Writing tests

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createOrder } from './orders';

describe('createOrder', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('rejects empty carts', async () => {
    await expect(createOrder({ items: [] })).rejects.toThrow(/empty/);
  });

  it.each([
    [1, 100],
    [3, 300],
  ])('prices %i items at %i', (qty, total) => {
    expect(createOrder.total(qty)).toBe(total);
  });
});
```

- One behaviour per test; name tests as sentences. Prefer `it.each` over loops.
- Use `expect.soft` for multiple independent assertions in one test when the repo uses it; otherwise split tests.
- `expectTypeOf<T>()` / `assertType` for type-level tests; run with `vitest --typecheck`.
- Concurrency: `describe.concurrent` / `it.concurrent` for independent async tests; use the `expect` from the test context (`({ expect })`) inside concurrent tests.
- `it.skip`, `it.todo`, `it.only` exist; never commit `.only` (lint rule `vitest/no-focused-tests` or `--allowOnly=false` in CI, which is the default outside watch mode).

### Mocking

```ts
import { vi } from 'vitest';
import { sendEmail } from './email';

vi.mock('./email', () => ({ sendEmail: vi.fn().mockResolvedValue({ id: 'e1' }) }));
// Partial mock keeping the rest real:
vi.mock('./config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./config')>()),
  apiUrl: 'http://test',
}));

const mocked = vi.mocked(sendEmail);
expect(mocked).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@b.c' }));
```

- `vi.mock(path, factory)` is hoisted above imports; variables used inside the factory must be declared with `vi.hoisted(() => ...)`.
- `vi.mock` applies to the whole test file; use `vi.doMock` for per-test (non-hoisted) mocks followed by a dynamic `await import()`.
- `vi.spyOn(obj, 'method')` for partial observation; restore with `mockRestore()` or `restoreMocks: true`.
- `vi.stubEnv('API_KEY', 'x')` and `vi.stubGlobal('fetch', vi.fn())`; `vi.unstubAllEnvs()`/`vi.unstubAllGlobals()` in `afterEach` or set `unstubEnvs: true`.
- For HTTP, prefer `msw` over mocking `fetch`; for timers use fake timers (below). Mock at the boundary (network, filesystem, clock), not internal modules, where possible.
- ESM default exports: the factory must return `{ default: ... }`.

### Fake timers

```ts
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('debounces', async () => {
  const fn = vi.fn();
  const d = debounce(fn, 100);
  d(); d();
  await vi.advanceTimersByTimeAsync(100);
  expect(fn).toHaveBeenCalledOnce();
});
```

- Use `vi.setSystemTime(new Date('2025-01-01'))` for `Date.now()`; `vi.useFakeTimers({ toFake: ['Date'] })` to fake only the clock.
- Use the `Async` variants (`advanceTimersByTimeAsync`, `runAllTimersAsync`) when callbacks contain promises.
- `nextTick`/`queueMicrotask` are not faked by default; pass `toFake` if needed.

### Snapshots

- Use inline snapshots (`toMatchInlineSnapshot()`) for small values; file snapshots (`__snapshots__/`) only for stable serialized output. Review every snapshot diff; `vitest -u` must not be run blindly.
- Prefer explicit assertions over snapshots for logic; snapshot only rendered output or serialized structures.
- `toMatchFileSnapshot('./out.html')` for large generated artifacts.

### Projects / workspace

```ts
// vitest.config.ts (Vitest 3)
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['src/**/*.test.ts'], environment: 'node' } },
      { test: { name: 'dom', include: ['src/**/*.dom.test.tsx'], environment: 'jsdom' } },
      'packages/*',                     // each package's own vitest.config
    ],
  },
});
```

In 2.x the same lives in `vitest.workspace.ts` (`defineWorkspace([...])`). Run a single project with `vitest --project unit`.

### Browser mode

- `test.browser: { enabled: true, provider: 'playwright', instances: [{ browser: 'chromium' }] }` (3.x) runs tests in a real browser; install `@vitest/browser` and `playwright`. Use for component tests that depend on layout or real DOM APIs; keep jsdom for cheap logic tests. Check https://vitest.dev/guide/browser/ for the exact option shape of the installed version.

## Common tasks

### Add Vitest to a project

```bash
npm i -D vitest @vitest/coverage-v8    # plus jsdom or happy-dom for DOM tests
```

Add `"test": "vitest run"`, `"test:watch": "vitest"`, `"test:coverage": "vitest run --coverage"` to `package.json`; create `vitest.config.ts`; if `globals: true`, add `"types": ["vitest/globals"]` to tsconfig.

### Run tests

```bash
npx vitest run                         # single run (CI)
npx vitest                             # watch mode
npx vitest run src/orders              # filter by path
npx vitest run -t "rejects empty"      # filter by name
npx vitest run --reporter=verbose
npx vitest run --coverage
npx vitest --ui                        # requires @vitest/ui
npx vitest run --project unit
```

### Test a React/Vue/Svelte component

- Install `@testing-library/<framework>` and `@testing-library/jest-dom`; add `import '@testing-library/jest-dom/vitest'` in `setupFiles`; set `environment: 'jsdom'`.
- Query by role/text, not test ids where possible; use `userEvent` over `fireEvent`.

### Migrate from Jest

1. `npm i -D vitest`; remove `jest`, `ts-jest`/`babel-jest`, `@types/jest`.
2. Convert `jest.config.*` to `vitest.config.ts` (`testEnvironment` -> `environment`, `setupFilesAfterEach` -> `setupFiles`, `moduleNameMapper` -> `resolve.alias`).
3. Set `globals: true` for a drop-in run, or codemod `jest.` to `vi.` and add explicit imports.
4. Differences: `vi.mock` factories must return the full module shape (no automock by default); `jest.requireActual` -> `importOriginal` in the factory; timers API is `vi.useFakeTimers()` (same names); `toHaveBeenCalledOnce()` exists; `jest.setTimeout` -> `testTimeout` option or per-test third argument.
5. Run the suite, fix module mocks first (most failures), then snapshots (format differs slightly; review).

## Pitfalls

- Referencing top-level variables inside a `vi.mock` factory throws because the call is hoisted; wrap them in `vi.hoisted`.
- Mocking a module that the test file imports via a different specifier (alias vs relative) does not apply; mock the same resolved path.
- Forgetting `await` on `rejects`/`resolves` assertions passes silently; enable `@typescript-eslint/no-floating-promises` or `vitest/valid-expect`.
- Fake timers with real `await` on a timer-dependent promise hang; use `advanceTimersByTimeAsync`.
- `environment: 'jsdom'` globally slows every test; scope it per file or project.
- Shared mutable module state across tests in the same file; `vi.resetModules()` + dynamic import if isolation is needed.
- Coverage thresholds set but `include` missing means untested files are not counted; set `coverage.include`.
- `.only` left in a file fails CI (`allowOnly` is false outside watch).
- Running `vitest` (watch) in CI hangs; use `vitest run`.

## Verification

```bash
npx vitest run                     # all green
npx vitest run --coverage          # thresholds met, if configured
npx tsc --noEmit                   # tests type-check
npx eslint .                       # includes eslint-plugin-vitest rules if configured
```

## References

- Vitest guide: https://vitest.dev/guide/
- Config reference: https://vitest.dev/config/
- Mocking: https://vitest.dev/guide/mocking.html
- API (vi, expect): https://vitest.dev/api/
- Migration from Jest: https://vitest.dev/guide/migration.html
- Browser mode: https://vitest.dev/guide/browser/
