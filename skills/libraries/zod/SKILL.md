---
name: zod
description: Validate and type data with Zod 3/4 - schema design, z.infer type inference, refinements and transforms, parsing at boundaries (API requests/responses, environment variables, forms), error formatting (flatten/treeifyError), and integration with react-hook-form, tRPC and Hono. Load when a project depends on zod or when validating input, defining DTOs, or deriving TypeScript types from runtime schemas.
---

# Zod

Assumes Zod 4 (`zod@4`, import `from 'zod'`). Zod 3 is still common; differences are flagged. Zod 4 also ships `zod/mini` (tree-shakeable functional API) and keeps `zod/v3` for gradual migration. Check `package.json` and the import path before using version-specific APIs.

## When to use

- Validating untrusted input: HTTP bodies/queries/params, webhook payloads, env vars, form values, JSON files, LLM output.
- Defining a single source of truth for types shared by client and server.
- Transforming/coercing input (strings to numbers/dates, trimming, defaults) while parsing.
- Formatting validation errors for APIs or forms.
- Wiring Zod into react-hook-form, tRPC, Hono, Fastify, Express, Next.js server actions, OpenAPI generation.

## Project conventions to detect first

1. Version: `zod` `^3` vs `^4` in `package.json`; imports `from 'zod'`, `'zod/v4'`, `'zod/mini'`. Zod 4 error API: `error.issues`, `z.treeifyError(err)`, `z.flattenError(err)`, `z.prettifyError(err)`; Zod 3: `error.errors`, `err.flatten()`, `err.format()`.
2. Schema location: `schemas/`, `lib/validation/`, colocated `*.schema.ts`, or inside tRPC routers / `packages/shared` in monorepos. Keep shared schemas in a package both sides import.
3. Naming: `userSchema` + `type User = z.infer<typeof userSchema>` or PascalCase `UserSchema`. Follow it.
4. Integrations present: `@hookform/resolvers` (react-hook-form), `@trpc/server`, `@hono/zod-validator`, `zod-validation-error`, `zod-to-json-schema`/`@asteasolutions/zod-to-openapi` (Zod 4 has `z.toJSONSchema()` built in), `t3-env`/`@t3-oss/env-nextjs` for env validation, `drizzle-zod`/`prisma-zod-generator`.
5. Error-shaping convention in API handlers (e.g. `{ errors: flattened.fieldErrors }`), and i18n of messages via `z.config({ customError })` (v4) or `z.setErrorMap` (v3).

## Core guidance

### Schema design

```ts
import { z } from 'zod';

export const userSchema = z.object({
  id: z.string().uuid(),                            // v4 also: z.uuid()
  email: z.string().email(),                        // v4 also: z.email()
  name: z.string().trim().min(1).max(100),
  age: z.number().int().positive().optional(),
  role: z.enum(['user', 'admin']).default('user'),
  tags: z.array(z.string()).max(10).default([]),
  createdAt: z.coerce.date(),                       // accepts ISO strings
});
export type User = z.infer<typeof userSchema>;           // output type (after defaults/transforms)
export type UserInput = z.input<typeof userSchema>;      // input type (before)

export const createUserSchema = userSchema.omit({ id: true, createdAt: true });
export const updateUserSchema = createUserSchema.partial();
```

- Derive types from schemas (`z.infer`), never write the interface by hand too. Export both schema and type from the same module.
- Compose with `.pick/.omit/.partial/.required/.extend/.merge` (v4: prefer `.extend` or spread `{ ...a.shape, ...b.shape }`; `.merge` is deprecated) instead of duplicating fields.
- Object strictness: `z.object` strips unknown keys by default; `z.strictObject()`/`.strict()` rejects them; `z.looseObject()`/`.passthrough()` keeps them. Reject unknown keys on write APIs where silent drops hide client bugs.
- Unions: `z.discriminatedUnion('type', [a, b])` for tagged objects (fast, clear errors); `z.union` otherwise. Literal unions: `z.enum([...])` or `z.literal(['a', 'b'])` (v4).
- Recursive types: v4 uses getters inside `z.object({ get children() { return z.array(node) } })`; v3 needs `z.lazy` plus an explicit `z.ZodType<T>` annotation.
- Records/maps: `z.record(z.string(), valueSchema)` (v4 requires both key and value schemas).
- Optional vs nullable vs nullish: match the wire format exactly (`null` from DBs, `undefined` from missing JSON keys).
- Dates: use `z.coerce.date()` or `z.iso.datetime()` (v4) / `z.string().datetime()` (v3) for ISO strings; JSON has no Date type.
- Keep schemas free of side effects and framework imports so they can be shared.

### Refinements and transforms

```ts
const passwordForm = z
  .object({ password: z.string().min(12), confirm: z.string() })
  .refine((d) => d.password === d.confirm, { message: 'Passwords do not match', path: ['confirm'] });

const slug = z.string().transform((s) => s.toLowerCase().replace(/\s+/g, '-'));
const positiveIntString = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive());

const unique = z.array(z.string()).superRefine((arr, ctx) => {       // v4: .check() is the newer API, superRefine still works
  if (new Set(arr).size !== arr.length) ctx.addIssue({ code: 'custom', message: 'Duplicates' });
});
```

- `.refine` for validation that returns boolean; `.superRefine`/`.check` for multiple issues or custom `path`.
- `.transform` changes the output type; after it, further validation requires `.pipe(nextSchema)`.
- Use `z.coerce.*` for query strings and form data (`"42"` -> 42, `"true"` -> true; note `z.coerce.boolean()` treats any non-empty string as true, so parse `'true'/'false'` explicitly with `z.enum(['true','false']).transform(v => v === 'true')`).
- `.default(value)` applies when input is `undefined` (v4: default short-circuits parsing, so it must already be output-typed; use `.prefault()` for input-typed defaults). `.catch(value)` swallows errors into a fallback; use sparingly.
- Async refinements (`.refine(async ...)`) require `parseAsync`/`safeParseAsync`.
- `.brand<'UserId'>()` for nominal types; `.readonly()` for readonly outputs.

### Parsing at boundaries

- Parse once at the edge, pass typed values inward. Internal functions should accept the inferred type, not `unknown`.
- `safeParse` in request handlers (return 400 with details); `parse` where failure is a programming error (config at startup, test fixtures).

```ts
// API route (any framework)
const result = createUserSchema.safeParse(await req.json());
if (!result.success) {
  return Response.json({ errors: z.flattenError(result.error).fieldErrors }, { status: 400 });   // v3: result.error.flatten()
}
const user = await createUser(result.data);
```

```ts
// env.ts: validate at startup, export typed config
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().default(3000),
  FEATURE_X: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});
export const env = envSchema.parse(process.env);   // crashes early with readable output
```

- Validate external API responses you depend on (`responseSchema.parse(await res.json())`) so upstream changes fail loudly where they happen.
- Also validate on the way out when the client must not receive extra fields: `publicUserSchema.parse(user)` strips unknown keys.

### Error formatting

- `error.issues` (v4; also present in v3) is the source of truth: `{ code, path, message }[]`.
- Field-level map for forms/APIs: `z.flattenError(error)` -> `{ formErrors: string[], fieldErrors: Record<string, string[]> }`. Nested structures: `z.treeifyError(error)`. Human-readable: `z.prettifyError(error)`. (v3: `error.flatten()`, `error.format()`, or the `zod-validation-error` package.)
- Custom messages: per check `z.string().min(1, 'Required')` or (v4) `{ error: 'Required' }`; global via `z.config({ customError: (iss) => ... })` (v4) or `z.setErrorMap` (v3). For i18n in v4 use `z.config(z.locales.de())`.
- Never leak raw `ZodError` stack traces to clients; map to a stable shape.

### Integrations

- react-hook-form: `useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({ resolver: zodResolver(schema) })` from `@hookform/resolvers/zod`; the three generics keep transformed output typed in `onSubmit` (resolvers v3.10+/v5 with RHF 7.55+). Errors appear in `formState.errors[field].message`; refinement `path` must match the field name.
- tRPC: `.input(createUserSchema)` on procedures; the client gets the inferred input type and `TRPCError` `BAD_REQUEST` with `cause: ZodError` on failure; shape it in `errorFormatter`.
- Hono: `import { zValidator } from '@hono/zod-validator'`; `app.post('/users', zValidator('json', createUserSchema), (c) => { const body = c.req.valid('json'); ... })`. Also `'query'`, `'param'`, `'form'`.
- Next.js server actions: `safeParse(Object.fromEntries(formData))` with `z.coerce` for numbers; return `{ errors }` to `useActionState`.
- Express/Fastify: a small middleware that `safeParse`s `req.body/query/params` and attaches `res.locals` or `req.validated`; Fastify can use `fastify-type-provider-zod` for route schemas and serialization.
- OpenAPI/JSON Schema: `z.toJSONSchema(schema)` (v4) or `zod-to-json-schema` (v3); `@asteasolutions/zod-to-openapi` for full OpenAPI docs.

## Common tasks

### Add a validated API endpoint

1. Define `xRequestSchema`/`xResponseSchema` in the shared schemas module; export types.
2. `safeParse` in the handler; return 400 with `flattenError` output.
3. Use `result.data` (typed) in the service; validate the outgoing payload if it comes from an untyped source.
4. Test: one happy path, one per failing rule, assert `fieldErrors` keys.

### Validate environment variables

Create `env.ts` as above, import `env` everywhere instead of `process.env`. For Next.js client vars use `@t3-oss/env-nextjs` or a separate `NEXT_PUBLIC_*` schema evaluated in the browser.

### Build a form schema with cross-field rules

`z.object({...}).refine(..., { path: ['fieldName'] })` so RHF shows the error on the right input; use `superRefine` for several messages.

### Migrate Zod 3 to 4

1. `npm i zod@4`; optionally switch imports to `'zod/v4'` first and move file by file.
2. Replace `.errors` with `.issues`, `.flatten()`/`.format()` with `z.flattenError`/`z.treeifyError`, `errorMap`/`invalid_type_error`/`required_error` params with the unified `error` param, `.merge` with `.extend`, `z.string().email()` with `z.email()` (old form still works but is deprecated), `z.record(v)` with `z.record(z.string(), v)`.
3. Re-run tests; defaults now apply before refinements and `.default` must be output-typed.
4. Check third-party libs support v4 (resolvers 5.x, trpc 11, hono validator latest) before switching.

## Pitfalls

- Hand-written interface drifting from the schema; use `z.infer`.
- `z.infer` on a schema with transforms gives the output type; for form default values and `useForm` generics use `z.input`.
- `z.coerce.boolean()` turning `"false"` into `true`.
- `z.object` silently stripping unknown keys on strict write APIs (use `strictObject`).
- Refinements on `z.object` running only after all field checks pass (v3) - cross-field errors appear only after individual field errors are fixed; v4 runs them unless `abortEarly`, but `.refine` on a failed object is still skipped when child issues exist. Structure messages accordingly.
- Calling `.optional()` before `.default()` or expecting `.default()` to handle `null` (it only handles `undefined`; use `.nullish()` + transform or `.catch`).
- Parsing `Date` objects from JSON without `coerce` (they are strings).
- Huge `z.union` of objects instead of `discriminatedUnion`; slow and unreadable errors.
- Returning the raw `ZodError` to clients or logging it as `[object Object]`; use `prettifyError`/`flattenError`.
- Async refinements with `parse` (throws "Async refinement encountered during synchronous parse").
- Putting Zod schemas in modules that import server-only code and then importing them in the browser bundle.

## Verification

```bash
npx tsc --noEmit       # inferred types line up with usage
npm test               # schema unit tests: valid, invalid, edge cases (empty strings, null vs undefined, coercions)
npm run lint
```

Quick manual check: `npx tsx -e "import { schema } from './src/schema'; console.log(schema.safeParse(sample))"`.

## References

- Zod docs (v4): https://zod.dev/
- Zod 4 migration guide: https://zod.dev/v4/changelog
- Error handling and formatting: https://zod.dev/error-formatting
- Zod 3 docs: https://v3.zod.dev/
- react-hook-form resolvers: https://github.com/react-hook-form/resolvers
- Hono zod validator: https://hono.dev/docs/guides/validation
- tRPC input validation: https://trpc.io/docs/server/validators
