---
name: jest
description: Write, configure and debug tests with Jest 29/30 in JavaScript and TypeScript projects. Covers jest.config with ts-jest, babel-jest or @swc/jest transforms, jest.fn/jest.mock module mocks, fake timers, async testing, snapshot discipline, coverage, and fixing ESM and transform errors. Use when a project depends on jest or has jest.config.js/ts/mjs, or when asked to add or fix Jest tests.
---

# Jest

Assumes Jest 29 or 30 on Node 18+. Check the version with `npx jest --version`; Jest 30 drops Node 16, updates `jsdom`, and renames some config (`testPathPattern` CLI became `--testPathPatterns`).

## When to use

- Adding or fixing `*.test.js|ts|tsx` / `*.spec.*` files run by Jest.
- Changing `jest.config.*`, transforms, `moduleNameMapper`, setup files, coverage.
- Debugging "Cannot use import statement outside a module", "SyntaxError: Unexpected token", module mock failures, open handles or slow suites.

## Project conventions to detect first

1. Config location: `jest.config.{js,ts,mjs,cjs}`, `"jest"` key in `package.json`, or a framework preset (`next/jest`, `jest-expo`, `@nestjs/testing`, `ts-jest` preset).
2. Transform: `ts-jest` (type-checks, slow), `babel-jest` (with `@babel/preset-typescript`, no type check), or `@swc/jest` (fast, no type check). Do not switch transforms unless asked.
3. Environment: `testEnvironment: 'node'` vs `'jsdom'` (needs `jest-environment-jsdom` as a separate install since Jest 28).
4. Module system: `"type": "module"` in `package.json` means ESM; Jest ESM support requires `node --experimental-vm-modules` and has mocking limits (see Pitfalls).
5. Setup: `setupFiles`, `setupFilesAfterEach` (`@testing-library/jest-dom`, global mocks), `moduleNameMapper` for aliases and CSS/assets, `testMatch`/`roots`.
6. Scripts: `test`, `test:watch`, `test:ci` (`--ci --coverage --runInBand`?), and whether a `globalSetup` starts a database or server.

## Core guidance

### Configuration

```ts
// jest.config.ts
import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  transform: { '^.+\\.tsx?$': ['@swc/jest'] },      // or ['ts-jest', { isolatedModules: true }]
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|scss)$': 'identity-obj-proxy',
  },
  setupFilesAfterEach: ['<rootDir>/test/setup.ts'],
  clearMocks: true,
  restoreMocks: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  coverageThreshold: { global: { lines: 80, branches: 70 } },
};
export default config;
```

- `jest.config.ts` needs `ts-node` (Jest 29) or is loaded natively on Node 22+ with Jest 30; if it fails to load, use `.mjs`/`.cjs`.
- `clearMocks` resets call history; `resetMocks` also removes implementations; `restoreMocks` restores `jest.spyOn` originals. Set `clearMocks` + `restoreMocks` at minimum.
- Use `projects: [...]` for monorepos or mixed node/jsdom suites, each with its own `displayName`.
- `testTimeout: 10000` globally rather than sprinkling `jest.setTimeout`.

### Writing tests

```ts
import { createOrder } from './orders';

describe('createOrder', () => {
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

- Always `await` or `return` promises; use `rejects`/`resolves` matchers. Use `expect.assertions(n)` when asserting inside `catch`.
- Avoid `done` callbacks; use async functions.
- `it.only`/`describe.only` must not be committed; CI should run with `--ci` and lint `jest/no-focused-tests`.
- Use `@testing-library/jest-dom` matchers for DOM; import from `@testing-library/jest-dom` in `setupFilesAfterEach`.

### Mocks

```ts
import { sendEmail } from './email';
jest.mock('./email');                              // automock: all exports become jest.fn()
const mockedSend = jest.mocked(sendEmail);
mockedSend.mockResolvedValue({ id: 'e1' });

jest.mock('./config', () => ({
  ...jest.requireActual<typeof import('./config')>('./config'),
  apiUrl: 'http://test',
}));
```

- `jest.mock(path)` calls are hoisted above imports by babel-jest/ts-jest/@swc/jest (the swc plugin needs `jsc.experimental.plugins` or `@swc/jest` 0.2.24+; check that mocks apply). Variables referenced in a factory must be prefixed `mock` (e.g. `const mockFn = jest.fn()`).
- `jest.spyOn(obj, 'method').mockImplementation(...)` to observe or stub without replacing the module.
- Per-test module mocks: `jest.isolateModules(() => { ... require('./thing') })` or `jest.doMock` + `require` inside the test.
- `jest.fn<ReturnType, Args>()` generics in Jest 29 changed to a single function type `jest.fn<(a: string) => number>()`; check `@types/jest` vs `@jest/globals` for the exact typing.
- For HTTP use `msw` or `nock`; avoid mocking `fetch`/`axios` internals unless the repo already does.
- Reset state: `beforeEach(() => jest.clearAllMocks())` if `clearMocks` is not in config.

### Fake timers

```ts
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('debounces', async () => {
  const fn = jest.fn();
  const d = debounce(fn, 100);
  d(); d();
  await jest.advanceTimersByTimeAsync(100);
  expect(fn).toHaveBeenCalledTimes(1);
});
```

- Modern timers (default since Jest 27) fake `Date`; `jest.setSystemTime(new Date('2025-01-01'))`.
- Use `advanceTimersByTimeAsync` / `runAllTimersAsync` (Jest 29.5+) when callbacks await promises.
- `jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })` when libraries depend on those.

### Snapshots

- Prefer `toMatchInlineSnapshot()` for small values and explicit matchers for logic. File snapshots only for stable serialized output.
- Never run `jest -u` without reviewing the diff. `--ci` makes missing snapshots fail instead of being written.
- Use property matchers for volatile fields: `expect(obj).toMatchSnapshot({ id: expect.any(String) })`.

### ESM

- Default Jest runs CommonJS; transforms compile TS/ESM source to CJS. Node modules shipping only ESM (e.g. `nanoid`, `chalk` 5, `lowdb`) throw `SyntaxError: Unexpected token 'export'`; fix with `transformIgnorePatterns: ['node_modules/(?!(nanoid|chalk)/)']` so they get transformed, or alias to a CJS build.
- Native ESM: set `extensionsToTreatAsEsm: ['.ts']`, `transform` with `useESM: true` (ts-jest) or swc `module.type: 'es6'`, run `NODE_OPTIONS=--experimental-vm-modules npx jest`, and use `jest.unstable_mockModule` + dynamic `await import()` for mocks (plain `jest.mock` does not work for ESM). Consider Vitest if ESM is a core need.

## Common tasks

### Add Jest to a TypeScript project

```bash
npm i -D jest @swc/jest @swc/core @types/jest     # or ts-jest for type-checked tests
npm i -D jest-environment-jsdom @testing-library/jest-dom   # DOM projects only
```

Create `jest.config.ts` as above; add `"test": "jest"`, `"test:ci": "jest --ci --coverage"` to scripts; add `"types": ["jest"]` to tsconfig if using globals, or import from `@jest/globals`.

### Run tests

```bash
npx jest                              # all
npx jest src/orders                   # path filter (Jest 30: --testPathPatterns)
npx jest -t "rejects empty"           # name filter
npx jest --watch                      # watch changed files (git)
npx jest --coverage
npx jest --runInBand                  # serial, for debugging or shared resources
npx jest --detectOpenHandles          # find why Jest does not exit
node --inspect-brk node_modules/.bin/jest --runInBand src/x.test.ts   # debugger
```

### Test code that uses a database or server

- Use `globalSetup`/`globalTeardown` to start/stop containers (testcontainers) once; per-file `beforeAll` to connect; `afterAll` to close pools (otherwise open handles).
- Use `--runInBand` or `maxWorkers: 1` when tests share a database, or isolate schemas per worker with `process.env.JEST_WORKER_ID`.

### Speed up a slow suite

1. `npx jest --listTests | wc -l` and `--verbose` to see slow files; `jest --showConfig` to confirm the transform.
2. Switch `ts-jest` to `isolatedModules: true` or to `@swc/jest`; move type checking to `tsc --noEmit`.
3. Scope `testEnvironment: 'jsdom'` per file with `/** @jest-environment jsdom */`.
4. Cache is in `/tmp/jest_*`; `--clearCache` if transforms behave oddly after config changes.

## Pitfalls

- `jest.mock` factory referencing a variable not prefixed `mock` throws "The module factory of jest.mock() is not allowed to reference any out-of-scope variables".
- Automock of a module with classes returns classes whose methods are `jest.fn()` returning `undefined`; set implementations explicitly.
- Forgetting `await` on `expect(...).rejects` makes the test pass before the assertion runs.
- `moduleNameMapper` order matters; first match wins; regex must escape dots.
- `jsdom` environment lacks `fetch`, `TextEncoder`, `structuredClone` in older versions; polyfill in `setupFiles`, or use `node` environment for non-DOM tests.
- Jest does not exit: unclosed DB pools, servers or intervals; `--detectOpenHandles` to find them, then close in `afterAll`. Do not paper over with `--forceExit`.
- `testEnvironment: 'jsdom'` global makes every test slow and masks Node-only bugs.
- Mixed CJS/ESM: transform not applied to `node_modules` by default; adjust `transformIgnorePatterns`.
- `resetMocks: true` wipes implementations set in `jest.mock` factories before each test, causing confusing `undefined` returns.
- Snapshots of objects with dates/IDs churn on every run; use property matchers.

## Verification

```bash
npx jest --ci                        # all green, no new snapshots written
npx jest --ci --coverage             # thresholds pass
npx tsc --noEmit                     # tests type-check (ts-jest only type-checks what it compiles)
npx eslint .                         # eslint-plugin-jest rules if configured
```

## References

- Jest docs: https://jestjs.io/docs/getting-started
- Configuration: https://jestjs.io/docs/configuration
- Mock functions and module mocks: https://jestjs.io/docs/mock-functions and https://jestjs.io/docs/manual-mocks
- Timer mocks: https://jestjs.io/docs/timer-mocks
- ECMAScript modules: https://jestjs.io/docs/ecmascript-modules
- ts-jest: https://kulshekhar.github.io/ts-jest/
- @swc/jest: https://swc.rs/docs/usage/jest
