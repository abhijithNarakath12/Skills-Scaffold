# Hono runtimes and RPC details

## Keep the app portable

```
src/app.ts        -> builds and exports `app` (no runtime imports)
src/node.ts       -> serve({ fetch: app.fetch })
src/worker.ts     -> export default app
src/lambda.ts     -> export const handler = handle(app)
```

Only entry files import from `@hono/node-server`, `hono/aws-lambda`, `hono/vercel`, etc.

## Environment access by runtime

| Runtime | Secrets/config | Notes |
|---|---|---|
| Cloudflare Workers | `c.env.NAME` (bindings from `wrangler.toml` `[vars]`, `wrangler secret put`) | type with `wrangler types`; `process.env` is unavailable unless `nodejs_compat` + polyfill |
| Node | `process.env.NAME` | `env(c)` from `hono/adapter` also works |
| Bun | `Bun.env.NAME` / `process.env` | `env(c)` works |
| Deno | `Deno.env.get('NAME')` | requires `--allow-env`; `env(c)` works |
| Vercel Edge | `process.env` injected at build | |
| Lambda | `process.env` | event/context at `c.env.event`, `c.env.lambdaContext` |

`env(c)` from `hono/adapter` returns the right source based on `getRuntimeKey()`.

## Cloudflare specifics

- Bindings: D1 (`c.env.DB.prepare(sql).bind(...).all()`), KV (`c.env.KV.get(key)`), R2, Queues, Durable Objects, AI. Pass `c.env` into service functions rather than importing a global.
- `c.executionCtx.waitUntil(p)` for after-response work; `c.executionCtx.passThroughOnException()`.
- Static assets: Workers Assets (`[assets]` in wrangler config) or `hono/cloudflare-workers` `serveStatic` with `__STATIC_CONTENT_MANIFEST` for older setups.
- Tests: `@cloudflare/vitest-pool-workers` with `defineWorkersConfig`; `import { env, SELF } from 'cloudflare:test'`.
- Scheduled handlers: `export default { fetch: app.fetch, scheduled: async (event, env, ctx) => {...} }`.

## Node specifics

```ts
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
app.use('/static/*', serveStatic({ root: './public' }));
const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) }, (info) => console.log(`listening on ${info.port}`));
process.on('SIGTERM', () => server.close());
```

Node 18+ is required for global `fetch`/`Request`/`Response`. Access the raw Node request only when needed: `import { getConnInfo } from '@hono/node-server/conninfo'`.

## RPC typing

### Server

```ts
const users = new Hono()
  .get('/', (c) => c.json({ users: [] as User[] }))
  .post('/', zValidator('json', schema), (c) => c.json({ id: 1 }, 201))
  .get('/:id', (c) => {
    const user = find(c.req.param('id'));
    if (!user) return c.json({ error: 'not found' }, 404);
    return c.json(user, 200);
  });

const app = new Hono().route('/api/users', users);
export type AppType = typeof app;
```

- Both status code literals and return shapes become part of the type; `res.status === 404` narrows the JSON type on the client.
- `c.json()` without a status defaults to 200 in types.
- Returning `Response` directly or `c.body()` loses JSON typing.

### Client

```ts
const client = hc<AppType>(baseUrl, { headers: () => ({ authorization: `Bearer ${token}` }), fetch: customFetch });
const res = await client.api.users.$post({ json: { email, name } });
const url = client.api.users[':id'].$url({ param: { id: '1' } }); // build a URL without calling
type Req = InferRequestType<typeof client.api.users.$post>;
type Res = InferResponseType<typeof client.api.users.$post, 201>;
```

- Query params: `{ query: { page: '1' } }` (strings).
- Form data: `{ form: { file } }`.
- Pass `init` as the second argument for per-call headers/signal.

### Performance of type inference

- Keep each sub-app under a few dozen routes; mount them via `app.route()`.
- Enable `"strict": true` and avoid `any` in handlers; `any` poisons inference.
- In monorepos, use TS project references and `"composite": true` so the server types are read from `.d.ts` instead of re-checked.
- If IDE latency is high, pre-compile the client type: `export const client = hc<AppType>(''); export type Client = typeof client;` then `hcWithType = (...args) => hc<AppType>(...args)` from a built package.

## Testing helpers

- `app.request(pathOrRequest, init?, env?, executionCtx?)`: direct invocation without network.
- `testClient(app)` from `hono/testing` gives the RPC client bound to `app.request`.
- For Workers, run tests under `vitest-pool-workers` so D1/KV bindings exist; Miniflare is embedded.
