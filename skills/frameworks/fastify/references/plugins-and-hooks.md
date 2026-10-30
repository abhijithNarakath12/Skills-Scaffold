# Fastify encapsulation, plugins and hooks

## Encapsulation model

```
root instance
├── register(dbPlugin via fp)        -> decorates root: fastify.db visible everywhere below
├── register(authPlugin via fp)      -> fastify.authenticate visible everywhere below
├── register(publicRoutes, {prefix:'/'})
│     child context: hooks added here apply only to publicRoutes
└── register(apiRoutes, {prefix:'/api'})
      child context: addHook('onRequest', fastify.authenticate) protects all /api routes
      ├── register(usersRoutes, {prefix:'/users'})
      └── register(ordersRoutes, {prefix:'/orders'})
```

- A plugin registered with `fastify.register(fn)` gets a **child** instance. Decorators, hooks, schemas (`addSchema`), content-type parsers and error handlers set on the child do not affect the parent or siblings.
- `fastify-plugin` (`fp`) skips the child creation so the plugin modifies the **caller's** instance. Use it for infrastructure (db, config, auth helpers, shared schemas), not for route plugins.
- `fp(plugin, { name, dependencies, fastify: '5.x', decorators: { fastify: ['config'] } })` asserts prerequisites at load time.
- Nested prefixes compose: `/api` + `/users` + route `/:id` = `/api/users/:id`.
- Check which context a route lives in with `fastify.printRoutes()` / `fastify.printPlugins()` after `ready()`.

## Load order

1. `register()` calls are queued; nothing runs until `ready()`/`listen()`/`inject()`.
2. Plugins load in registration order, depth-first; a plugin's children load before the next sibling.
3. `await fastify.register(x)` forces the queue to load up to and including `x`, so the next line can use its decorators. Use this for config and db plugins when subsequent registrations need them synchronously.
4. `after()` callbacks run after the previous `register` finishes.

## Hooks

### Request/reply hooks (in order)

| Hook | Has | Typical use |
|---|---|---|
| `onRequest` | raw request, no body | auth via headers, request id, rate limiting |
| `preParsing` | stream | decompress, size checks |
| `preValidation` | parsed body, not validated | normalize payload before schema check |
| `preHandler` | validated body/params/query | load entities, authorization using body |
| handler | | |
| `preSerialization` | payload object | redact, wrap envelope |
| `onError` | error | logging, metrics (cannot change the reply) |
| `onSend` | serialized payload | set headers, modify string/buffer |
| `onResponse` | reply done | timing metrics |
| `onTimeout` | | cleanup when `connectionTimeout` hits |
| `onRequestAbort` | | client disconnected |

Async hook: `fastify.addHook('preHandler', async (request, reply) => { ... })`. To end the request early, `return reply.code(401).send(...)`; Fastify sees `reply.sent` and stops the chain.

### Application hooks

`onRoute` (inspect/modify each route as registered, used to apply hooks based on `routeOptions.config`), `onRegister` (each child context), `onReady`, `onListen`, `preClose`, `onClose` (cleanup db pools, timers).

## Per-route configuration

```ts
fastify.get('/admin', { config: { roles: ['admin'] }, onRequest: fastify.authenticate }, handler);

fastify.addHook('preHandler', async (request, reply) => {
  const roles = request.routeOptions.config.roles;
  if (roles && !roles.some((r) => request.user?.roles.includes(r))) {
    return reply.forbidden(); // from @fastify/sensible
  }
});
```

Type `config` by augmenting `FastifyContextConfig` in `fastify` module declaration.

## Error handler scoping

`setErrorHandler` and `setNotFoundHandler` are encapsulated too: set them on the root for defaults, override inside a context for a different API shape (e.g. `/api` returns JSON while `/` renders HTML).

Error handler template:

```ts
fastify.setErrorHandler((error, request, reply) => {
  if (error.validation) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: error.message, details: error.validation });
  }
  const status = error.statusCode ?? 500;
  if (status >= 500) request.log.error({ err: error }, 'unhandled error');
  reply.status(status).send({ statusCode: status, error: status >= 500 ? 'Internal Server Error' : error.name, message: status >= 500 ? 'Internal Server Error' : error.message });
});
```
