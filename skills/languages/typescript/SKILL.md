---
name: typescript
description: Write, refactor and review TypeScript (5.x) in Node, browser and framework projects. Covers strict typing, module and tsconfig conventions, narrowing, generics, async patterns, error handling, project structure, and the tooling loop (tsc, eslint, vitest/jest, esbuild/tsup). Use when editing .ts/.tsx files or a project with tsconfig.json.
---

# TypeScript

Assumes TypeScript 5.x. Advice applies to both Node and browser code unless noted.

## When to use

- Editing or creating `.ts` / `.tsx` / `.mts` / `.cts` files.
- Changing `tsconfig.json`, type definitions, or build tooling for a TypeScript project.
- Reviewing TypeScript for type safety, API design or async correctness.

## Project conventions to detect first

Before writing code, check:

1. `tsconfig.json`: `strict`, `module`/`moduleResolution` (`NodeNext`, `Bundler`, `ESNext`), `target`, `paths` aliases, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`. Match what is enabled; do not loosen settings to make code compile.
2. `package.json`: `"type": "module"` (ESM) vs CommonJS, the `scripts` (build, test, lint, typecheck), the test runner (vitest, jest, node:test), the bundler (esbuild, tsup, vite, webpack), and the package manager (lockfile: `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `bun.lockb`).
3. Lint/format: `eslint.config.*` or `.eslintrc*`, `biome.json`, `.prettierrc`. Run them rather than hand-formatting.
4. Existing style: `interface` vs `type`, named vs default exports, file naming (`kebab-case.ts` vs `PascalCase.ts`), barrel files, how errors and results are modelled.

## Core guidance

### Types

- Keep `strict: true`. Never add `// @ts-ignore`; use `// @ts-expect-error` with a reason only when unavoidable.
- Avoid `any`. Use `unknown` at boundaries and narrow it. For partially known shapes use `Record<string, unknown>` or a validated schema (zod, valibot, arktype) at I/O edges.
- Prefer `interface` for object shapes that may be extended, `type` for unions, intersections, mapped and conditional types. Follow the repo's existing preference.
- Model states as discriminated unions rather than optional fields:

```ts
type LoadState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error };
```

- Use `as const` for literal tuples/objects, `satisfies` to check a value against a type without widening, and template literal types for string formats.
- Exhaustiveness: in `switch` over a union, add a `default: { const _exhaustive: never = value; throw new Error(...) }` branch.
- Prefer narrowing (`in`, `typeof`, `instanceof`, type predicates `x is T`) over casts. A cast `as T` is a claim the compiler cannot check; comment why it is safe.
- Enable `noUncheckedIndexedAccess` in new projects; treat `arr[i]` and `obj[key]` as possibly `undefined`.
- Keep generics minimal: a type parameter must appear at least twice (in input and output) to be useful.

### Modules and structure

- Use ESM `import`/`export`; with `NodeNext` resolution, relative imports need explicit `.js` extensions in source (`./util.js` even for `util.ts`).
- `import type { X }` / `export type { X }` for type-only imports (required with `verbatimModuleSyntax` or `isolatedModules`).
- Avoid circular imports; extract shared types into a `types.ts` module.
- Prefer named exports. Barrel files (`index.ts`) are fine for public package surfaces, not for every folder.
- Keep runtime validation at boundaries (HTTP handlers, CLI args, file parsing, env vars) and trust types inside.

### Async and errors

- Always `await` or explicitly return promises; enable `@typescript-eslint/no-floating-promises`.
- Use `Promise.all`/`allSettled` for independent work; sequential `await` in loops only when order matters.
- Throw `Error` subclasses (or the project's error type) with a `cause`; never throw strings. Consider a `Result<T, E>` type for expected failures in library code if the repo already uses one.
- Use `AbortSignal` for cancellable operations; propagate signals through fetch and timers.
- Handle `unknown` in `catch` blocks: `catch (err) { if (err instanceof HttpError) ... }`.

### Node specifics

- Target modern Node (18+/20+): built-in `fetch`, `node:test`, `fs/promises`, `AbortController`, `structuredClone`.
- Use `node:` prefixed imports (`import fs from 'node:fs/promises'`).
- Read config from `process.env` in one place with validation; do not sprinkle `process.env.X!` through the code.

### Browser / DOM specifics

- Add `"lib": ["DOM", "DOM.Iterable"]` only in browser targets.
- Narrow `querySelector` results (`HTMLInputElement | null`) rather than `!`-asserting.

## Common tasks

### Add a new module

1. Create `src/<area>/<name>.ts` following the repo's naming.
2. Export a small, typed public surface; keep helpers unexported.
3. Add `src/<area>/<name>.test.ts` (or the repo's test location) with the test runner already in use.
4. Run `tsc --noEmit`, the linter, and the tests.

### Introduce a shared type

1. Put it in the nearest `types.ts` (or the domain module) and export it with `export type`/`export interface`.
2. Replace duplicated inline shapes with the shared type; let the compiler find mismatches.

### Migrate JavaScript to TypeScript

1. Rename to `.ts`, enable `allowJs` + `checkJs` during transition if the repo is mixed.
2. Start with `strict: true` and fix errors; use `unknown` not `any` for unclear inputs.
3. Add types for third-party modules without typings via `@types/*` or a `declarations.d.ts` with `declare module 'x'`.

### Tighten tsconfig

Recommended for new projects:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "skipLibCheck": true
  }
}
```

Turn flags on one at a time in existing projects and fix errors in a dedicated change.

### Write tests

- Vitest: `import { describe, it, expect } from 'vitest'`; `vi.mock()` for modules, `vi.useFakeTimers()` for time.
- Jest with ts-jest or `@swc/jest`; check `jest.config.*` for the transform.
- `node:test`: compile first (or run with `tsx`), `import { test } from 'node:test'; import assert from 'node:assert/strict'`.
- Type-level tests: `expectTypeOf` (vitest) or `// @ts-expect-error` assertions.

## Pitfalls

- Enums: prefer union string literal types or `as const` objects; `enum` emits runtime code and `const enum` breaks with `isolatedModules`.
- `Object.keys(obj)` returns `string[]`, not `(keyof T)[]`; cast deliberately or use a typed helper.
- Optional chaining hides bugs when the thing should never be null; prefer a type that excludes null.
- `JSON.parse` returns `any`; validate or at least annotate as `unknown`.
- Index signatures and `Record<string, T>` make every key look present; prefer `Map` or `Partial<Record<K, T>>`.
- Mutating function parameters and arrays passed in; prefer returning new values, use `readonly` arrays in signatures.
- Default exports hinder refactoring and tree-shaking; use named exports unless a framework requires default.
- Forgetting `.js` extensions under `NodeNext`, or mixing CJS `require` into ESM.

## Verification

Discover the exact commands in `package.json` scripts; typical loop:

```bash
npx tsc --noEmit            # type check (or npm run typecheck)
npm run lint                # eslint / biome
npm test                    # vitest / jest / node --test
npm run build               # confirm the bundler/emit still works
```

Fix all type errors; do not suppress them. Re-run after every substantive change.

## References

- TypeScript handbook: https://www.typescriptlang.org/docs/handbook/
- tsconfig reference: https://www.typescriptlang.org/tsconfig
- Total TypeScript tsconfig cheat sheet: https://www.totaltypescript.com/tsconfig-cheat-sheet
- typescript-eslint rules: https://typescript-eslint.io/rules/
