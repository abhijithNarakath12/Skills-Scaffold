---
name: eslint-prettier
description: Configure and run ESLint 9 flat config, typescript-eslint, Prettier and Biome in JavaScript/TypeScript projects. Covers migrating from .eslintrc, choosing and overriding rules, type-aware linting, editor integration, running lint and format checks in CI, and when to fix versus suppress. Use when editing eslint.config.*, .eslintrc*, .prettierrc or biome.json, or when asked to fix lint or formatting errors.
---

# ESLint, Prettier and Biome

Assumes ESLint 9 (flat config, `eslint.config.{js,mjs,cjs,ts}`), typescript-eslint 8, Prettier 3, Biome 1.9/2.x. Check versions with `npx eslint --version`, `npx prettier --version`, `npx biome --version`.

## When to use

- Setting up or changing lint/format config; migrating `.eslintrc.*` to flat config.
- Fixing lint or formatting failures locally or in CI.
- Choosing between ESLint+Prettier and Biome; wiring editor-on-save and pre-commit hooks.

## Project conventions to detect first

1. Which tools exist: `eslint.config.*` (flat) vs `.eslintrc.*` + `.eslintignore` (legacy, removed in ESLint 9 unless `ESLINT_USE_FLAT_CONFIG=false`), `.prettierrc*` + `.prettierignore`, `biome.json(c)`. A repo should have one formatter; do not add Prettier to a Biome repo or vice versa.
2. `package.json` scripts: `lint`, `lint:fix`, `format`, `format:check`, `typecheck`; lint-staged/husky or lefthook configuration; CI steps that run them.
3. Framework presets in use: `eslint-plugin-react`, `react-hooks`, `jsx-a11y`, `@next/eslint-plugin-next`, `eslint-plugin-vue`, `eslint-plugin-svelte`, `eslint-plugin-import-x`, `eslint-plugin-unicorn`, `eslint-plugin-vitest`/`jest`, `eslint-plugin-playwright`.
4. Type-aware linting: `parserOptions.projectService: true` (or `project: './tsconfig.json'`) and `tseslint.configs.recommendedTypeChecked`/`strictTypeChecked`.
5. Editor settings committed: `.vscode/settings.json` (`editor.defaultFormatter`, `editor.codeActionsOnSave`), `.editorconfig`.
6. Rule philosophy visible in the config: strict (`strictTypeChecked`, `unicorn`) vs minimal (`recommended`). Follow it; do not add dozens of rules in an unrelated change.

## Core guidance

### ESLint 9 flat config

```js
// eslint.config.js  (ESM; use .mjs if package.json lacks "type": "module")
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', '*.config.*'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  prettier,   // last: disables stylistic rules that conflict with Prettier
);
```

- Flat config is an array of config objects; later objects override earlier ones. `files`/`ignores` are globs relative to the config file. A config object with only `ignores` is a global ignore.
- `tseslint.config()` is a typed helper (optional; `defineConfig` from `eslint/config` in ESLint 9.22+ is the core equivalent).
- Type-aware rules need `projectService: true` (tseslint 8) which uses the nearest `tsconfig.json` per file; files not covered by a tsconfig error out ("not included in any project"), so add them to a `tsconfig.eslint.json` or put them in `ignores`.
- `eslint-config-prettier` must be last; use `eslint-plugin-prettier` only if the repo already runs Prettier through ESLint (slower; running Prettier separately is preferred).
- Plugins are imported and registered in `plugins: { react }`; many ship flat presets (`reactHooks.configs['recommended-latest']`, `react.configs.flat.recommended`). Check each plugin's README for its flat export name.
- `.eslintignore` is not read; use `ignores`. `--ext` is gone; file matching comes from `files` patterns (defaults cover `**/*.js, .mjs, .cjs`; add `**/*.ts, **/*.tsx` via tseslint or your own `files`).

### Migrating from .eslintrc

1. `npx @eslint/migrate-config .eslintrc.json` produces a starting `eslint.config.mjs` (uses `FlatCompat` for plugins without flat support).
2. Replace `extends` strings with imported configs; replace `env` with `languageOptions.globals` from the `globals` package; `parserOptions` move under `languageOptions`; `overrides` become separate objects with `files`.
3. Remove `.eslintignore`, `root: true`, and `eslint-plugin-prettier` if Prettier runs separately.
4. Run `npx eslint . --debug 2>&1 | head` or `npx eslint --inspect-config` (opens the config inspector) when a rule unexpectedly applies or not.
5. Compare rule sets with `npx eslint --print-config src/index.ts` before/after.

### Prettier

```json
// .prettierrc
{ "semi": true, "singleQuote": true, "trailingComma": "all", "printWidth": 100 }
```

- Keep options minimal; the defaults are the point. Add a `.prettierignore` (`dist`, `coverage`, lockfiles, generated code).
- Plugins: `prettier-plugin-tailwindcss` (class sorting), `prettier-plugin-organize-imports`, `prettier-plugin-svelte`/`astro`; list them in `"plugins"`.
- `prettier --write .` to format, `prettier --check .` in CI. Format whole files; do not hand-format.

### Biome

```json
// biome.json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "formatter": { "enabled": true, "indentStyle": "space", "lineWidth": 100 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "single", "trailingCommas": "all" } },
  "files": { "ignore": ["dist", "coverage"] }
}
```

- One tool for lint + format, very fast, no type-aware rules (as of 1.x; check https://biomejs.dev for 2.x type inference). Commands: `biome check --write .`, `biome ci .`, `biome format --write .`, `biome lint .`.
- `biome migrate eslint` / `biome migrate prettier` import existing configs. Match the `$schema` version to the installed `@biomejs/biome`.
- Biome 2 renamed `files.ignore` to `files.includes` with negations; check the installed version's schema before editing.

### Rule selection philosophy

- Start from `recommended` (+ `TypeChecked` for TS); add rules that catch bugs (`no-floating-promises`, `no-misused-promises`, `switch-exhaustiveness-check`, `react-hooks/exhaustive-deps`), not stylistic preferences the formatter already handles.
- Prefer `error` for anything in CI; `warn` only for rules being phased in, with a deadline.
- Turn off a rule globally only with a comment explaining why; prefer scoping with `files`.
- Keep lint fast: type-aware rules on `src/**`, not on huge generated folders.

### Fix vs suppress

- Fix the code. Run `eslint --fix` for auto-fixable rules and review the diff; auto-fixes for `prefer-const`, `consistent-type-imports` etc. are safe, some (`no-unused-vars` removal) are not available for that reason.
- Suppress a single line only with a reason: `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party type is untyped`. Never add file-wide `/* eslint-disable */` or remove rules to make CI green.
- Unused variables: delete them or prefix `_` per the configured pattern.
- `any` complaints: type the value or use `unknown` and narrow.
- Prettier conflicts with ESLint stylistic rules mean `eslint-config-prettier` is missing or not last.

## Common tasks

### Set up ESLint + Prettier in a TypeScript project

```bash
npm i -D eslint @eslint/js typescript-eslint globals eslint-config-prettier prettier
```

Create `eslint.config.js` (above), `.prettierrc`, `.prettierignore`; add scripts:

```json
{ "lint": "eslint .", "lint:fix": "eslint . --fix", "format": "prettier --write .", "format:check": "prettier --check ." }
```

Add `.vscode/settings.json`: `"editor.defaultFormatter": "esbenp.prettier-vscode"`, `"editor.formatOnSave": true`, `"editor.codeActionsOnSave": { "source.fixAll.eslint": "explicit" }`, and `"eslint.useFlatConfig": true` for older extension versions.

### Pre-commit

```bash
npm i -D husky lint-staged && npx husky init
```

`.husky/pre-commit`: `npx lint-staged`; `package.json`: `"lint-staged": { "*.{ts,tsx,js}": ["eslint --fix", "prettier --write"], "*.{json,md,css}": "prettier --write" }`. Or lefthook if the repo uses it.

### CI

```yaml
- run: npm ci
- run: npm run lint -- --max-warnings=0
- run: npm run format:check
- run: npx tsc --noEmit
```

Cache ESLint with `eslint --cache --cache-location node_modules/.cache/eslint` for large repos. Biome: `npx biome ci .`.

### Debug "why is this rule firing / not firing"

```bash
npx eslint --print-config path/to/file.ts | grep -A2 '"rule-name"'
npx eslint --inspect-config           # visual config inspector
npx eslint path/to/file.ts --debug
DEBUG=eslint:* npx eslint file.ts     # verbose plugin loading
```

## Pitfalls

- Keeping both `.eslintrc.*` and `eslint.config.*`: ESLint 9 uses only the flat config and silently ignores the legacy file.
- `ignores` with a leading `./` or absolute paths does not match; use `dist/**`.
- Type-aware rules on files outside the tsconfig `include` fail; add them to `tsconfig.eslint.json` or ignore them.
- `eslint-config-prettier` not last, or `eslint-plugin-prettier` plus a separate Prettier run doing double work and conflicting versions.
- Running `prettier --write` on generated or vendored files; extend `.prettierignore`.
- Biome and Prettier formatting the same files differently in different editors; pick one and remove the other extension setting.
- `--max-warnings` missing in CI so warnings accumulate forever.
- Disabling `react-hooks/exhaustive-deps` instead of fixing dependency arrays.
- Lint-staged running the full `tsc` on every commit (slow); type-check in CI or `tsc -p` on a small project.
- Upgrading `typescript-eslint` major without reading the release notes; rule names and presets change (`recommended-requiring-type-checking` became `recommendedTypeChecked`).

## Verification

```bash
npx eslint . --max-warnings=0        # clean
npx prettier --check .               # formatted (or npx biome ci .)
npx tsc --noEmit                     # lint config did not hide type errors
npx eslint --print-config src/index.ts > /dev/null   # config resolves without error
```

## References

- ESLint flat config: https://eslint.org/docs/latest/use/configure/configuration-files
- Migration guide: https://eslint.org/docs/latest/use/configure/migration-guide
- typescript-eslint getting started: https://typescript-eslint.io/getting-started/
- typescript-eslint typed linting: https://typescript-eslint.io/getting-started/typed-linting/
- eslint-config-prettier: https://github.com/prettier/eslint-config-prettier
- Prettier options: https://prettier.io/docs/options
- Biome: https://biomejs.dev/guides/getting-started/
