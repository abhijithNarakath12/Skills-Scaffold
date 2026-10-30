---
name: javascript
description: Write, refactor and review modern JavaScript (ES2022+) in Node and browser projects that do not use TypeScript. Covers ESM vs CommonJS, package.json conventions and exports, async patterns, error handling, JSDoc typing, eslint/prettier, and testing with node:test, vitest or jest. Use when editing .js/.mjs/.cjs files in a project with package.json and no tsconfig.json.
---

# JavaScript

Assumes ES2022+ syntax, Node 20+ for server code, and evergreen browsers (or a bundler) for client code. If the project also has `tsconfig.json` or `.ts` files, load the `typescript` skill instead.

## When to use

- Editing or creating `.js`, `.mjs`, `.cjs`, `.jsx` files without TypeScript.
- Changing `package.json` (scripts, `exports`, `type`), ESLint/Prettier config, or test setup in a JS project.
- Reviewing JavaScript for async correctness, module hygiene or error handling.

## Project conventions to detect first

Before writing code, check:

1. **Module system**: `"type": "module"` in `package.json` means `.js` is ESM; absent or `"commonjs"` means `.js` is CJS. `.mjs` is always ESM, `.cjs` always CJS. Match the existing files; do not mix `require` and `import` in one file.
2. **Runtime target**: `engines.node` in `package.json`, `.nvmrc`/`.node-version`, `browserslist`, CI matrix. Do not use syntax or APIs newer than the target (e.g. `Array.prototype.toSorted` needs Node 20, `Object.groupBy` Node 21+, `using` declarations need a transpiler).
3. **Package manager**: lockfile decides it. `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lockb`/`bun.lock` → bun, `package-lock.json` → npm. Also check `packageManager` field. Never generate a second lockfile.
4. **Scripts**: `package.json` `scripts` for build, test, lint, format, dev. Run those, not ad-hoc commands.
5. **Lint/format**: `eslint.config.js` (flat config, ESLint 9) vs `.eslintrc.*` (legacy), `.prettierrc`, `biome.json`. Whether `eslint-config-prettier` is in place. Match the configured quote style, semicolons and indentation by running the formatter.
6. **Testing**: `vitest.config.*`, `jest.config.*`, `node --test` in scripts, `mocha`/`.mocharc.*`. Where tests live (`__tests__/`, `*.test.js`, `test/`).
7. **Bundler / framework**: `vite.config.*`, `webpack.config.*`, `rollup.config.*`, `esbuild` in scripts, or none (plain Node).
8. **Typing**: `// @ts-check` headers, `jsconfig.json`, `checkJs` in a `tsconfig.json` used only for checking, JSDoc usage. If present, keep JSDoc types accurate.

## Core guidance

### Modules

- Prefer ESM. New files use `import`/`export`; in Node, relative imports include the file extension (`./util.js`) because ESM resolution does not add it.
- Use `node:` prefixed builtins: `import { readFile } from 'node:fs/promises'`.
- Named exports by default; one default export only when a framework or convention demands it.
- In ESM there is no `__dirname`/`require`; use `import.meta.url` with `fileURLToPath`, `import.meta.dirname` (Node 20.11+), and `createRequire(import.meta.url)` when a CJS-only dependency must be loaded synchronously.
- Interop: ESM can `import` CJS (default export = `module.exports`); CJS can only load ESM with `await import()` (or `require(esm)` on Node 22.12+/23+, check `node --version`).
- Publishing a package: declare `"exports"` (with `import`/`require` conditions if dual), `"files"`, `"sideEffects": false` when true. Keep `"main"` for old tooling.

```json
{
  "name": "@scope/pkg",
  "type": "module",
  "exports": {
    ".": { "import": "./src/index.js", "types": "./types/index.d.ts" },
    "./package.json": "./package.json"
  },
  "files": ["src", "types"],
  "engines": { "node": ">=20" }
}
```

### Language idioms

- `const` by default, `let` when reassigned, never `var`.
- Strict equality (`===`), optional chaining (`?.`), nullish coalescing (`??`, `??=`), destructuring with defaults, spread for copies, template literals.
- Classes with `#private` fields where state must be encapsulated; otherwise plain functions and closures. Avoid prototype hacking.
- Prefer `for...of` over `forEach` when you need `await`, `break`, or `continue`.
- Use `Map`/`Set` for keyed collections; plain objects only for fixed-shape records. Create dictionaries with `Object.create(null)` or `Map` to avoid prototype keys.
- `structuredClone` for deep copies; `Object.freeze` for constants meant to be immutable.
- Use `Intl.*` for formatting dates/numbers; `Temporal` is not yet available without a polyfill, so use `Date` carefully (UTC, ISO strings) or a library already in the repo.

### Async

- `async`/`await` everywhere; never mix `.then()` chains with `await` in the same function.
- Fire independent work concurrently: `await Promise.all([...])`; use `Promise.allSettled` when partial failure is acceptable. Sequential `await` in a loop only when order matters.
- Never leave a promise floating: `await` it, `return` it, or attach `.catch`. Enable ESLint `no-floating-promises` (via `eslint-plugin-promise` or `@typescript-eslint` with JS parsing) if the repo has it.
- Cancellation: accept an `AbortSignal` and pass it to `fetch`, `setTimeout` (`timers/promises`), streams. `AbortSignal.timeout(ms)` for deadlines.
- Streams: use `node:stream/promises` `pipeline`, async iteration (`for await (const chunk of stream)`), and Web Streams in browser code.
- Event listeners and timers must be removed/cleared on teardown to avoid leaks (`controller.abort()`, `clearInterval`).

### Errors

- Throw `Error` (or subclasses) only, never strings or plain objects. Pass context via `{ cause }`:

```js
export class HttpError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message, { cause });
    this.name = 'HttpError';
    this.status = status;
  }
}
```

- Catch at the level that can handle or convert the error; log once, at the boundary (request handler, CLI entry, worker loop).
- Check `err instanceof X` or `err?.code === 'ENOENT'` rather than matching message text.
- In Node, register `process.on('unhandledRejection', ...)` only in the entry point, and treat it as a bug signal, not control flow.

### Typing without TypeScript

- Add `// @ts-check` at the top of files and JSDoc annotations for exported functions when the repo uses them; `tsc --noEmit --allowJs --checkJs` (or `jsconfig.json` with `checkJs`) then catches mistakes.

```js
/**
 * @param {string} id
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<User | null>}
 */
export async function findUser(id, options = {}) { /* ... */ }
```

- Define shared shapes with `@typedef` in a `types.js` and import them via `/** @import { User } from './types.js' */` (TS 5.5+) or `@typedef {import('./types.js').User} User`.
- Validate external input at runtime (zod, valibot, ajv, or hand-written checks) regardless of JSDoc.

### Browser specifics

- Use `addEventListener` with `{ signal }` for bulk cleanup; `querySelector` results can be `null`, check before use.
- Use `fetch` with explicit `response.ok` checks; `await response.json()` throws on invalid bodies.
- Avoid globals; use modules (`<script type="module">`) and keep DOM access in a thin layer.

### Node specifics

- Read env once in a `config.js` module with defaults and validation; export a frozen object.
- Use `node:fs/promises`, `node:path`, `node:url`, `node:util` (`parseArgs`, `promisify`), `node:timers/promises`.
- Prefer `node:test` + `node:assert/strict` for dependency-free tests in libraries; vitest/jest in apps that already use them.

## Common tasks

### Add a module

1. Create `src/<area>/<name>.js` matching the repo's module style (ESM with `.js` extensions in imports, or CJS `module.exports`).
2. Export a small named surface; keep helpers unexported.
3. Add `src/<area>/<name>.test.js` (or the repo's location/pattern).
4. Run lint, format, tests.

### Convert a file or package from CommonJS to ESM

1. Set `"type": "module"` (or rename files to `.mjs`) and update `exports`/`main`.
2. Replace `require`/`module.exports` with `import`/`export`; add `.js` extensions to relative imports.
3. Replace `__dirname`/`__filename` with `import.meta.dirname` / `import.meta.filename` (Node 20.11+) or `fileURLToPath(import.meta.url)`.
4. Rename any remaining CJS config files (`.eslintrc.cjs`, `jest.config.cjs`) or convert them.
5. Run tests and `node --check` on entry points; check consumers that `require()` the package.

### Write tests

- `node:test`: `import { test, describe, mock } from 'node:test'; import assert from 'node:assert/strict';` run with `node --test` (add `--watch`, `--test-name-pattern`). `mock.method(obj, 'fn')`, `mock.timers.enable()`.
- vitest: `import { describe, it, expect, vi } from 'vitest'`; `vi.mock('./dep.js')`, `vi.useFakeTimers()`; run `npx vitest run` (CI) or `npx vitest` (watch).
- jest with ESM needs `--experimental-vm-modules` or a transform (babel-jest); check `jest.config.*` before assuming `import` works in tests.
- Test behaviour through the public surface; mock only I/O boundaries (network, fs, time).

### Set up ESLint 9 flat config + Prettier

```js
// eslint.config.js
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  { languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } } },
  prettier,
];
```

Add scripts: `"lint": "eslint ."`, `"format": "prettier --write ."`, `"format:check": "prettier --check ."`.

### Add a CLI entry point

1. `bin/<name>.js` with `#!/usr/bin/env node` first line; `"bin": { "<name>": "bin/<name>.js" }` in `package.json`.
2. Parse args with `node:util` `parseArgs` (or `commander`/`yargs` if already present).
3. Set `process.exitCode` instead of calling `process.exit()` mid-flight so streams flush.

## Pitfalls

- Mixing `require` into an ESM file or `import` into CJS; `.js` meaning depends on the nearest `package.json` `type`.
- Missing `.js` extension in relative ESM imports in Node (works in bundlers, fails in `node`).
- `forEach(async ...)` does not await; use `for...of` or `Promise.all(arr.map(async ...))`.
- Floating promises and unhandled rejections crashing Node 15+ processes.
- `==` coercion, `typeof null === 'object'`, `NaN !== NaN` (use `Number.isNaN`), `Array.isArray` for arrays.
- `parseInt` without radix; prefer `Number(x)` and validate.
- `JSON.parse` on untrusted input without try/catch and schema validation.
- Mutating shared objects/arrays passed as arguments; return new values (`toSorted`, spread) instead of `sort`/`splice` in place.
- Hoisting surprises with function declarations and `var`; use `const` arrow functions or declare before use.
- Relying on `this` in callbacks; use arrow functions or `bind` explicitly.
- Checking `err.message` strings instead of `instanceof`/`code`.
- Default-exported objects and barrel files that pull the whole package into every bundle; export named functions and set `sideEffects: false` when true.
- Leaving `console.log` debugging in library code; use a logger (`pino`, `winston`, or `console.error` at the CLI boundary).

## Verification

Discover the exact commands in `package.json` `scripts`; typical loop with the detected package manager:

```bash
npm run lint              # eslint . (fix with: npx eslint . --fix)
npm run format:check      # prettier --check .
npm test                  # node --test | vitest run | jest
npm run build             # if a bundler is configured
npx tsc --noEmit -p jsconfig.json   # only if checkJs/jsconfig is set up
node --check src/index.js           # syntax check for a single entry file
```

Fix all lint and test failures; do not disable rules inline to pass (`// eslint-disable-next-line` needs a reason comment).

## References

- MDN JavaScript reference: https://developer.mozilla.org/en-US/docs/Web/JavaScript
- Node.js ESM docs: https://nodejs.org/api/esm.html
- Node.js packages and `exports`: https://nodejs.org/api/packages.html
- node:test runner: https://nodejs.org/api/test.html
- ESLint flat config: https://eslint.org/docs/latest/use/configure/configuration-files
- JSDoc types supported by TypeScript: https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html
- Vitest: https://vitest.dev/guide/
