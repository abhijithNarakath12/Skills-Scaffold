---
name: fastify
description: Build and maintain Fastify 4/5 servers on Node.js, covering plugins and encapsulation, route schemas with JSON Schema or TypeBox, hooks, error handling, decorators, pino logging, serialization and testing with app.inject(). Use when a project depends on fastify, when editing route/plugin files registered with fastify.register, or when adding endpoints, schemas, hooks or tests to a Fastify service.
---

# Fastify

Assumes Fastify 5 (Node 20+) and notes Fastify 4 differences. Fastify is schema-first: every route should declare its `schema` so validation (Ajv) and serialization (fast-json-stringify) are generated, not hand-written.

## When to use

- Adding routes, plugins, hooks, decorators, schemas or error handlers to a Fastify app.
- Setting up logging, CORS, auth, rate limiting, static files or Swagger with the `@fastify/*` ecosystem.
- Writing tests with `fastify.inject()`.
- Not for NestJS-on-Fastify (use the nestjs skill) or Express apps.

## Project conventions to detect first

1. Fastify major in `package.json`. Fastify 5 requires Node 20, removed the deprecated `request.routerPath`/`request.routerMethod`/`reply.context` (use `request.routeOptions.url`/`.method`/`.config`) and `reply.getResponseTime()` (use `reply.elapsedTime`); `@fastify/*` plugins must be the matching major (v5 plugins for Fastify 5). Check with `npm ls fastify` and the migration guide for anything else.
2. Schema style: plain JSON Schema objects, `@sinclair/typebox` with `@fastify/type-provider-typebox`, `zod` with `fastify-type-provider-zod`, or `json-schema-to-ts`. Use the provider already in use.
3. Module system and TypeScript (`tsx`, `tsc`, `esbuild`). Fastify 5 is ESM-friendly; CommonJS still works.
4. Layout: `fastify-cli` apps have `app.js` plus `plugins/` and `routes/` folders loaded by `@fastify/autoload`; hand-rolled apps build the instance in `src/app.ts` (`build()` function) and call `listen` in `src/server.ts`.
5. Plugin wrapper: `fastify-plugin` (`fp`) around shared plugins (decorators, DB connections); its presence tells you what is meant to leak into the parent scope.
6. Logging: `logger: true` or a pino config object; `pino-pretty` in dev via `transport`.
7. Common plugins: `@fastify/cors`, `@fastify/helmet`, `@fastify/jwt`, `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/swagger` + `@fastify/swagger-ui`, `@fastify/env`, `@fastify/sensible`, `@fastify/static`, `@fastify/multipart`, `@fastify/postgres`/`@fastify/mongodb`.
8. Tests: `node --test`, `tap`, `vitest`, `jest`; look for `t.after(() => app.close())` or `afterAll`.

## Core guidance

### App construction

```ts
// src/app.ts
import Fastify, { type FastifyServerOptions } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import usersRoutes from './routes/users.js';
import db from './plugins/db.js';

export function build(opts: FastifyServerOptions = {}) {
  const app = Fastify(opts).withTypeProvider<TypeBoxTypeProvider>();
  app.register(db);
  app.register(usersRoutes, { prefix: '/users' });
  return app;
}

// src/server.ts
const app = build({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
try {
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
```

- `listen` with `host: '0.0.0.0'` inside containers; default binds localhost only.
- `await app.ready()` to load plugins without listening (tests, serverless).
- Use `fastify-cli` (`fastify start -l info app.js`) if the project was scaffolded with `fastify generate`.

### Plugins and encapsulation

- Everything is a plugin: `async function plugin(fastify, opts) { ... }` registered with `fastify.register(plugin, opts)`.
- Each `register` creates a child context. Decorators, hooks and plugins registered inside are visible only to that context and its children, not to siblings or parents.
- To share a decorator app-wide (DB client, config, auth helper), wrap the plugin with `fastify-plugin`:

```ts
import fp from 'fastify-plugin';
export default fp(async (fastify) => {
  const pool = createPool(fastify.config.DATABASE_URL);
  fastify.decorate('db', pool);
  fastify.addHook('onClose', async () => pool.end());
}, { name: 'db', dependencies: ['config'] });
```

- Declare `name` and `dependencies` in `fp` options so load order is checked.
- Prefer async plugins (`async (fastify, opts) => {}`); if using the callback form, call `done()` exactly once.
- Plugin registration is lazy until `ready()`/`listen()`; use `await fastify.register(...)` when subsequent code needs the decorator immediately (e.g. `app.config` from `@fastify/env`).
- Route files are plain plugins; use `{ prefix }` on registration, not hard-coded prefixes in paths.

### Routes and schemas

```ts
import { Type } from '@sinclair/typebox';

const Params = Type.Object({ id: Type.Integer({ minimum: 1 }) });
const User = Type.Object({ id: Type.Integer(), email: Type.String({ format: 'email' }) });

export default async function usersRoutes(fastify: FastifyInstance) {
  fastify.get('/:id', {
    schema: { params: Params, response: { 200: User, 404: fastify.getSchema('HttpError') ?? Type.Object({ message: Type.String() }) } },
  }, async (request, reply) => {
    const user = await fastify.db.users.find(request.params.id); // typed from Params
    if (!user) return reply.code(404).send({ message: 'User not found' });
    return user; // serialized with the 200 schema
  });
}
```

- Always declare `body`, `querystring`, `params`, `headers` and `response` schemas. Response schemas speed up serialization and strip undeclared fields (acts as an allow-list).
- Querystring values are coerced by Ajv (`coerceTypes: 'array'` default) according to the schema; without a schema they are strings.
- Return a value from an async handler or call `reply.send()`; never both. If you `await reply.send()` or call it asynchronously inside a callback, `return reply` to signal Fastify.
- Shared schemas: `fastify.addSchema({ $id: 'User', ... })` then `{ $ref: 'User#' }`; with TypeBox use `Type.Ref`.
- `fastify.route({ method, url, schema, preHandler, handler })` for full options; shorthand `fastify.get/post/put/patch/delete`.
- Custom Ajv options (formats, `removeAdditional`) go in `Fastify({ ajv: { customOptions, plugins } })`; `ajv-formats` is included by default.

### Hooks

Request lifecycle order: `onRequest` -> `preParsing` -> `preValidation` -> `preHandler` -> handler -> `preSerialization` -> `onSend` -> `onResponse`; `onError` runs when a handler throws; `onTimeout` on `connectionTimeout`.

- Auth belongs in `onRequest` (before body parsing) or `preHandler` when you need the parsed body.
- Route-level hooks: `fastify.get('/x', { onRequest: [fastify.authenticate] }, handler)`.
- Application hooks: `onReady`, `onListen`, `onClose`, `onRoute`, `onRegister`.
- Hooks are encapsulated like decorators; register in the right scope.
- Async hooks must not call `done`; sync hooks must call it.

### Error handling

- Throw errors or `return reply.code(400).send(...)`. Errors with `statusCode` (e.g. from `@fastify/sensible`'s `fastify.httpErrors.notFound()` or `@fastify/error`) are rendered with that status.
- Default error payload: `{ statusCode, error, message, code? }`. Customize with `fastify.setErrorHandler((error, request, reply) => { request.log.error(error); reply.status(error.statusCode ?? 500).send({ ... }); })`.
- Validation errors have `error.validation` and `error.validationContext`; map them to 400 in the error handler or with `fastify.setSchemaErrorFormatter`.
- `fastify.setNotFoundHandler()` for 404; respects encapsulation prefixes.
- Do not swallow errors in hooks; `throw` and let the error handler respond.

### Decorators and typing

- `fastify.decorate('db', pool)`, `fastify.decorateRequest('user', null)`, `fastify.decorateReply('sendError', fn)`. Initialize request/reply decorators with `null` or a getter, never a shared object (it would be shared across requests).
- Augment types once in `src/types/fastify.d.ts`:

```ts
declare module 'fastify' {
  interface FastifyInstance { db: Pool; authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>; }
  interface FastifyRequest { user: { id: number } | null; }
}
```

### Logging

- Pino is built in: `request.log.info({ userId }, 'created user')` carries the `reqId`. Use `fastify.log` outside requests.
- Configure redaction for secrets: `logger: { redact: ['req.headers.authorization'] }`.
- Set `genReqId` to use an incoming `x-request-id` header when behind a gateway. Set `trustProxy: true` behind a proxy so `request.ip` and protocol are correct.
- `disableRequestLogging: true` plus your own `onResponse` hook if the default per-request lines are too noisy.

## Common tasks

### Add an endpoint

1. Define request/response schemas (TypeBox or JSON Schema) next to the route or in `src/schemas/`.
2. Add the route in the resource's plugin with `schema`, hooks (`onRequest: [fastify.authenticate]`) and an async handler.
3. Put logic in a service or repository decorated on the instance (`fastify.db`, `fastify.services.users`).
4. Add an `inject` test for success, validation failure (400) and not-found.
5. If `@fastify/swagger` is used, confirm the route appears at `/documentation` and add `tags`/`summary` in the schema.

### Add config

```ts
import fp from 'fastify-plugin';
import env from '@fastify/env';
export default fp(async (fastify) => {
  await fastify.register(env, {
    dotenv: true,
    schema: { type: 'object', required: ['DATABASE_URL'], properties: { PORT: { type: 'integer', default: 3000 }, DATABASE_URL: { type: 'string' } } },
  });
}, { name: 'config' });
```

Access via `fastify.config.PORT` (type augmentation needed).

### Add JWT auth

1. `npm i @fastify/jwt`; register with `fastify.register(jwt, { secret: fastify.config.JWT_SECRET })` in an `fp` plugin.
2. Decorate `fastify.decorate('authenticate', async (request, reply) => { await request.jwtVerify(); })`.
3. Protect routes via `onRequest: [fastify.authenticate]`; sign tokens with `fastify.jwt.sign({ sub: user.id })` or `reply.jwtSign`.

### Write a test

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../src/app.js';

test('GET /users/:id', async (t) => {
  const app = build({ logger: false });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/users/1' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { id: 1, email: 'a@b.co' });
});
```

`inject` never opens a socket; `await app.ready()` is implied. Override plugins for tests by passing options into `build()` (e.g. a fake db) rather than mocking modules.

### Upgrade Fastify 4 to 5

1. Node 20+. `npm i fastify@5` and bump every `@fastify/*` plugin to its Fastify 5 major; run `npm ls` to find mismatches (they throw `FST_ERR_PLUGIN_VERSION_MISMATCH`).
2. Replace `request.routerPath`/`request.routerMethod`/`reply.context.config` with `request.routeOptions.url`/`.method`/`.config`.
3. Replace `reply.getResponseTime()` with `reply.elapsedTime`; re-run tests, since schema and logging defaults also changed.
4. Full list: https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/

## Pitfalls

- Decorating or adding hooks inside a plugin without `fastify-plugin` and expecting the parent or siblings to see them.
- Registering a route after `ready()`/`listen()` (`FST_ERR_INSTANCE_ALREADY_LISTENING`).
- `reply.send()` inside an async handler without `return reply`, causing "Promise may not be fulfilled with undefined" warnings or double sends.
- Missing `response` schema: fields leak (passwords), and serialization is slower.
- Response schema omits a field, so it silently disappears from the output; keep schemas in sync with service return types.
- `decorateRequest('ctx', {})` with an object shared across all requests; use `null` and assign in a hook.
- Plugin version mismatch after upgrading Fastify (plugins pin a Fastify major).
- Using Express-style `(req, res, next)` middleware without `@fastify/middie` or `@fastify/express`.
- Forgetting `host: '0.0.0.0'` in Docker (health checks fail).
- Ajv `coerceTypes` surprises: `?flag=false` becomes boolean only if the schema says `type: 'boolean'`.
- `app.close()` not called in tests, leaving handles open.

## Verification

```bash
cat package.json | jq .scripts
npm run lint
npx tsc --noEmit
npm test                      # node --test / tap / vitest with app.inject
npm run build && node dist/server.js
curl -i localhost:3000/health
fastify print-routes app.js   # fastify-cli projects: list registered routes
```

## References

- [references/plugins-and-hooks.md](references/plugins-and-hooks.md): encapsulation model, hook order and `fastify-plugin` usage in depth.
- Fastify docs: https://fastify.dev/docs/latest/
- Type providers (TypeBox, Zod, JSON-Schema-to-TS): https://fastify.dev/docs/latest/Reference/Type-Providers/
- Ecosystem plugins: https://fastify.dev/ecosystem/
- v5 migration guide: https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/
