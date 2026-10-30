---
name: express
description: Build and maintain Express 4/5 HTTP APIs and servers on Node.js, covering routers, middleware order, async error handling, validation, auth, configuration, logging, security headers, project layout and testing with supertest. Use when a project depends on express, when editing app.js/server.js/routes or middleware files, or when adding endpoints, error handlers or tests to an Express service.
---

# Express

Assumes Express 5 on Node 18+ (Express 5 is the default `npm install express` since late 2024) and notes the differences for Express 4. Check which one is installed before touching error handling or route syntax.

## When to use

- Adding or changing routes, routers, middleware, error handlers or request validation.
- Wiring configuration, logging, CORS, security headers, sessions or auth into an Express app.
- Writing HTTP tests with `supertest`.
- Structuring or refactoring an Express codebase.
- Not for Next.js API routes, NestJS (uses Express underneath but has its own skill), or serverless handlers that merely wrap Express.

## Project conventions to detect first

1. Express major version in `package.json` (`"express": "^5"` vs `"^4"`). Express 5: async handlers that reject are forwarded to error middleware automatically, `req.query` is a getter (read-only), path-to-regexp 8 syntax (`/:id`, `/*splat`, `{/optional}`; no `/foo*` or regex-in-string), `res.status()` rejects non-integers, `app.del` removed. Express 4: you must `next(err)` yourself for async errors (or use `express-async-errors`).
2. Module system: `"type": "module"` + `import`, or CommonJS `require`. Match it.
3. TypeScript: `@types/express` version must match the Express major (`@types/express@5` for Express 5). Build via `tsx`, `ts-node`, `tsc` or `esbuild`; check `scripts`.
4. Layout: `src/app.js` (builds the app, no `listen`) separate from `src/server.js` (calls `listen`) is the testable pattern. Routers in `src/routes/` or feature folders (`src/users/users.router.js`), handlers in `controllers/`, business logic in `services/`.
5. Existing middleware: `helmet`, `cors`, `morgan`/`pino-http`, `express-rate-limit`, `cookie-parser`, `express-session`, `passport`, `compression`. Reuse rather than duplicate.
6. Validation library: `zod`, `joi`, `express-validator`, `yup`, `celebrate`. Use the one present.
7. Config: `dotenv` + a `config.js` that reads and validates `process.env` once; or `convict`/`env-var`/zod schema. Never read `process.env` scattered through handlers.
8. Test runner: `jest`, `vitest`, `mocha`, or `node --test`; HTTP tests via `supertest`.

## Core guidance

### App structure

```js
// src/app.js
import express from 'express';
import helmet from 'helmet';
import { usersRouter } from './routes/users.js';
import { errorHandler, notFound } from './middleware/errors.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // only when behind a reverse proxy / load balancer
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use('/api/users', usersRouter);
  app.use(notFound);
  app.use(errorHandler); // last
  return app;
}

// src/server.js
import { createApp } from './app.js';
import { config } from './config.js';
const server = createApp().listen(config.port, () => console.log(`listening on ${config.port}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
```

- Export the app without listening so tests can import it.
- Middleware order is execution order. Body parsers, security headers, logging and CORS come before routers; 404 and error handlers come last.
- Mount routers with a prefix (`app.use('/api/users', usersRouter)`); use `express.Router({ mergeParams: true })` when a nested router needs parent params.

### Routing

- One router per resource: `router.get('/')`, `router.get('/:id')`, `router.post('/')`, `router.patch('/:id')`, `router.delete('/:id')`.
- Keep handlers thin: parse and validate input, call a service, send a response. No DB queries directly in route files.
- `router.param('id', loader)` to load an entity once for every route using `:id`.
- `router.route('/:id').get(...).patch(...).delete(...)` to group methods for one path.
- Respond exactly once. After `res.json()`/`res.send()`/`res.redirect()`, `return`.
- Use `res.status(201).json(created)` for creates, `res.status(204).end()` for deletes.
- Express 5 path syntax: wildcards need a name (`/files/*path`), optional segments use braces (`/users{/:id}`); regex characters in strings are not allowed. Express 4: `/files/*`, `/users/:id?`.

### Error handling

- Error middleware has four parameters; Express identifies it by arity: `(err, req, res, next)`.
- Express 5: `async (req, res) => { throw ... }` or a rejected promise reaches the error handler. Express 4: wrap every async handler:

```js
// Express 4 only
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
router.get('/:id', wrap(async (req, res) => { res.json(await users.find(req.params.id)); }));
```

- Define an `HttpError` class (`status`, `message`, optional `code`/`details`) and throw it from services; map everything else to 500 without leaking the stack in production.

```js
export function notFound(req, res) {
  res.status(404).json({ error: 'Not Found' });
}
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.status ?? err.statusCode ?? 500;
  req.log?.error({ err }, 'request failed');
  res.status(status).json({ error: status >= 500 ? 'Internal Server Error' : err.message, details: err.details });
}
```

- Body-parser errors (`entity.parse.failed`, `entity.too.large`) carry `err.type`/`err.status`; let them flow to the same handler.
- Set `NODE_ENV=production` in production; Express 4 prints stacks in default error output otherwise.

### Validation

- Validate `body`, `params` and `query` at the edge, before the service is called. With zod:

```js
import { z } from 'zod';
export const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse({ body: req.body, params: req.params, query: req.query });
  if (!result.success) return res.status(400).json({ error: 'Validation failed', details: result.error.flatten() });
  res.locals.input = result.data; // Express 5: req.query is read-only, so store parsed data elsewhere
  next();
};
```

- With `express-validator`: chain `body('email').isEmail()`, then `validationResult(req)` in a shared middleware.
- Coerce query strings explicitly (`z.coerce.number()`); everything in `req.query` is a string or array of strings.

### Auth

- Prefer stateless JWT (`jsonwebtoken`/`jose`) for APIs: `Authorization: Bearer` header, verify in an `authenticate` middleware that sets `req.user`, and `authorize(...roles)` middleware for route-level checks.
- Sessions (`express-session` with a store such as `connect-redis`) for browser apps; never use the default MemoryStore in production. Set `cookie: { httpOnly: true, secure: true, sameSite: 'lax' }`.
- `passport` strategies if already present; otherwise do not add it for simple JWT.
- Hash passwords with `bcrypt` or `argon2`; never log tokens or credentials.

### Security and operations

- `helmet()` for headers, `cors({ origin: allowList, credentials: true })` with an explicit origin list (never `*` with credentials), `express-rate-limit` on auth and public endpoints, `hpp` if query pollution matters.
- Request logging with `pino-http` (JSON, fast) or `morgan('combined')`; attach a request id (`pino-http` does, or `express-request-id`).
- Health endpoint `GET /healthz` returning 200 with no auth; readiness checks DB connectivity.
- Graceful shutdown: close the server on `SIGTERM`/`SIGINT`, then close DB pools.
- Serve static files with `express.static('public', { maxAge: '1d' })`; put a CDN or reverse proxy in front in production.
- `compression()` only if no proxy already compresses.

## Common tasks

### Add an endpoint

1. Add a validation schema in `src/routes/<resource>.schemas.js` (or next to the router).
2. Add the handler in the router: `router.post('/', validate(createSchema), async (req, res) => { const item = await service.create(res.locals.input.body); res.status(201).json(item); })`.
3. Put the business logic in `src/services/<resource>.js`; throw `HttpError(404)` etc. from there.
4. Write a supertest test covering 2xx, 400 (validation) and 404.
5. Update API docs/OpenAPI if the project maintains one (`swagger-jsdoc`, `swagger-ui-express`).

### Add middleware

1. Write `(req, res, next) => {...}` in `src/middleware/<name>.js`; call `next()` exactly once or send a response.
2. Register globally with `app.use()` before the routers, or per-router/route by passing it as an argument.
3. Store derived data on `res.locals` (or `req.user` for auth); do not mutate `req.query` in Express 5.

### Configure the app

```js
// src/config.js
import 'dotenv/config';
import { z } from 'zod';
export const config = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
}).parse(process.env);
```

Fail fast at startup when configuration is missing.

### Write a test

```js
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

it('creates a user', async () => {
  const res = await request(app).post('/api/users').send({ email: 'a@b.co' }).expect(201);
  expect(res.body).toMatchObject({ email: 'a@b.co' });
});

it('rejects invalid input', async () => {
  await request(app).post('/api/users').send({}).expect(400);
});
```

Use a test database or an in-memory repository injected into `createApp(deps)`; do not hit production services. Test the error handler by asserting that a thrown service error yields the right status and does not leak a stack.

### Upgrade Express 4 to 5

1. `npm i express@5 @types/express@5` (if TS).
2. Run `npx @expressjs/codemod upgrade` to migrate deprecated signatures; review the diff.
3. Fix route patterns (`*` -> `*splat`, `:id?` -> `{/:id}`, remove regex strings).
4. Remove `express-async-errors` and manual wrappers (optional but cleaner).
5. Replace `req.query` mutation and `res.send(status)` / `res.redirect('back')` usages.
6. Migration guide: https://expressjs.com/en/guide/migrating-5.html

## Pitfalls

- Error handler registered before routes, or missing the fourth `next` parameter (then it is treated as normal middleware).
- Express 4 async handler without `try/catch` + `next(err)`: the request hangs and the process may crash on unhandled rejection.
- Calling `next()` after sending a response, or sending twice (`ERR_HTTP_HEADERS_SENT`).
- Forgetting `express.json()` so `req.body` is `undefined` (Express 5) or `{}` (Express 4).
- `app.listen` inside the module that tests import, so tests open a real port.
- `trust proxy` not set behind a load balancer: `req.ip`, `secure` cookies and rate limiting misbehave. Setting it to `true` when not behind a proxy lets clients spoof `X-Forwarded-For`.
- `cors()` with `origin: '*'` plus `credentials: true` (browsers reject it).
- Reading `process.env` lazily inside handlers instead of validating config at startup.
- Wildcard routes (`app.use('/')`) catching API 404s and serving the SPA `index.html` for JSON clients; register API routers first and scope the SPA fallback.
- Blocking the event loop with sync file or crypto calls (`fs.readFileSync`, `bcrypt.hashSync`) inside handlers.

## Verification

```bash
cat package.json | jq .scripts    # discover the project's commands
npm run lint                      # eslint
npx tsc --noEmit                  # if TypeScript
npm test                          # jest/vitest/node --test with supertest
node --check src/server.js        # quick syntax check for plain JS
npm start                         # then curl -i localhost:3000/healthz
```

## References

- [references/middleware-and-errors.md](references/middleware-and-errors.md): middleware ordering, error flow and Express 4 vs 5 differences in detail.
- Express 5 API: https://expressjs.com/en/5x/api.html
- Migrating to Express 5: https://expressjs.com/en/guide/migrating-5.html
- Production best practices: https://expressjs.com/en/advanced/best-practice-performance.html and https://expressjs.com/en/advanced/best-practice-security.html
- supertest: https://github.com/ladjs/supertest
