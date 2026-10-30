# Express middleware order and error flow

## Order of registration is order of execution

```
app.use(helmet())                 // 1. security headers on every response
app.use(pinoHttp())               // 2. logging + request id
app.use(cors(opts))               // 3. CORS preflight must answer before auth
app.use(express.json())           // 4. body parsing
app.use(rateLimit(opts))          // 5. throttling (often only on specific routers)
app.use('/api/auth', authRouter)  // 6. public routers
app.use(authenticate)             // 7. everything below requires a user
app.use('/api/users', usersRouter)
app.use(notFound)                 // 8. no route matched
app.use(errorHandler)             // 9. four-arg error middleware, always last
```

Rules:

- A middleware that neither sends a response nor calls `next()` hangs the request.
- `next('route')` skips the remaining handlers for the current route; `next(err)` jumps to the next error middleware, skipping normal middleware.
- Router-level `router.use()` only applies to routes in that router and is scoped to the mount path.
- Multiple handlers per route run in sequence: `router.post('/', authenticate, validate(schema), handler)`.
- `app.use('/path', fn)` matches `/path` and `/path/anything`; `app.get('/path', fn)` matches `/path` only.

## Error flow

1. A handler throws (sync) or rejects (async, Express 5) or calls `next(err)`.
2. Express skips to the first middleware with four parameters.
3. That middleware either responds, or calls `next(err)` to pass along (for example to a logging error middleware, then a responding one).
4. If no error middleware responds, Express's default handler sends 500 with the stack in non-production.

Check `res.headersSent` first; if true, delegate to `next(err)` so Express closes the connection.

### Express 4 async handlers

Express 4 ignores returned promises. Options:

- Wrap handlers: `const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)`.
- `import 'express-async-errors'` once at startup (patches `Router`).
- Upgrade to Express 5.

### Express 5 async handlers

Rejected promises from any handler or middleware are forwarded to `next(err)`. Returning a value from a handler is ignored; you still call `res.json(...)`.

## Typed errors

```js
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);
```

Map third-party errors in the handler (for example Prisma `P2002` -> 409, zod `ZodError` -> 400, `jsonwebtoken` `TokenExpiredError` -> 401) so services stay framework-agnostic.

## Express 4 to 5 differences that bite

| Area | Express 4 | Express 5 |
|---|---|---|
| Async errors | manual `next(err)` | automatic |
| `req.query` | plain object, mutable | getter; assign parsed values elsewhere |
| Path syntax | `*`, `:id?`, regex chars in strings | `*splat`, `{/:id}`, no regex chars |
| `res.send(200)` | sends status | removed; use `res.sendStatus(200)` |
| `res.redirect('back')` | works | removed; use `req.get('Referrer')` |
| `app.del` | works | removed; `app.delete` |
| `req.param(name)` | deprecated | removed |
| `res.json(obj, status)` | works | removed; `res.status(s).json(obj)` |
| `req.body` without parser | `{}` | `undefined` |
| Node requirement | 0.10+ | 18+ |

Run `npx @expressjs/codemod upgrade` for the mechanical parts, then fix routes by hand.
