---
name: socket-io
description: Build realtime features with Socket.IO 4 on server and client - typed events, namespaces and rooms, acknowledgements with timeouts, auth middleware, reconnection and connection state recovery, scaling with the Redis/Postgres/cluster adapters and sticky sessions, binary and volatile events, and testing. Load when a project depends on socket.io or socket.io-client, or when adding WebSocket-style realtime messaging, presence, or live updates.
---

# Socket.IO 4

Assumes `socket.io` 4.x server (Node 18+) and `socket.io-client` 4.x (browser, Node, React Native). Server and client major versions must match (v4 <-> v4; v3 clients work with v4 servers only with `allowEIO3: true`). Socket.IO is not a plain WebSocket server; raw `ws` clients cannot connect.

## When to use

- Adding live updates (notifications, chat, collaborative editing, dashboards, presence) between server and browsers/mobile.
- Structuring events into namespaces/rooms, adding acknowledgements, request/response over sockets.
- Authenticating socket connections, handling reconnects, deploying behind load balancers, or scaling to several instances.
- Testing socket handlers.

## Project conventions to detect first

1. Versions of `socket.io` and `socket.io-client`; `@socket.io/redis-adapter`, `@socket.io/redis-streams-adapter`, `@socket.io/postgres-adapter`, `@socket.io/cluster-adapter`, `@socket.io/admin-ui`.
2. HTTP framework integration: `new Server(httpServer, opts)` with Express/Fastify/Koa/NestJS (`@nestjs/websockets` gateways) or Next.js custom server. Note the `path` (default `/socket.io/`) and `cors` settings.
3. Shared event typings: a `socket-events.ts` (or `packages/shared`) with `ServerToClientEvents`, `ClientToServerEvents`, `InterServerEvents`, `SocketData`. If absent, add one and import it on both sides.
4. Client singleton: `lib/socket.ts` exporting `io(URL, { autoConnect: false, ... })`, connected in an auth-aware effect/provider; React hooks around it.
5. Auth: JWT in `socket.handshake.auth.token`, session cookie (`withCredentials`), or query params (avoid; logged in URLs).
6. Room naming conventions (`user:${id}`, `room:${id}`), event naming (`chat:message`, `order.updated`), payload schemas (zod).
7. Deployment: sticky sessions config (nginx `ip_hash`/cookie, ALB stickiness), `transports` restrictions, serverless hosts (not supported for long-lived connections).

## Core guidance

### Typed events (shared file)

```ts
// shared/socket-events.ts
export interface ServerToClientEvents {
  'chat:message': (msg: { id: string; roomId: string; text: string; from: string; at: number }) => void;
  'presence:update': (users: string[]) => void;
}
export interface ClientToServerEvents {
  'chat:join': (roomId: string, ack: (res: { ok: true; history: Message[] } | { ok: false; error: string }) => void) => void;
  'chat:send': (payload: { roomId: string; text: string }, ack: (res: { ok: boolean; id?: string }) => void) => void;
}
export interface InterServerEvents { ping: () => void }
export interface SocketData { userId: string; name: string }
```

### Server

```ts
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents, InterServerEvents, SocketData } from '../shared/socket-events';

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
  cors: { origin: ['https://app.example.com'], credentials: true },
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
  maxHttpBufferSize: 1e6,                 // 1 MB per message (default)
});

// auth middleware runs once per connection
io.use(async (socket, next) => {
  try {
    const user = await verifyJwt(socket.handshake.auth.token);
    socket.data.userId = user.id;
    socket.data.name = user.name;
    next();
  } catch {
    next(new Error('unauthorized'));      // client receives connect_error with this message
  }
});

io.on('connection', (socket) => {
  socket.join(`user:${socket.data.userId}`);          // personal room for targeted pushes

  socket.on('chat:join', async (roomId, ack) => {
    if (!(await canJoin(socket.data.userId, roomId))) return ack({ ok: false, error: 'forbidden' });
    await socket.join(`room:${roomId}`);
    ack({ ok: true, history: await loadHistory(roomId) });
  });

  socket.on('chat:send', async ({ roomId, text }, ack) => {
    const parsed = messageSchema.safeParse({ roomId, text });
    if (!parsed.success) return ack({ ok: false });
    const msg = await saveMessage(socket.data.userId, parsed.data);
    io.to(`room:${roomId}`).emit('chat:message', msg);   // includes sender; use socket.to(...) to exclude
    ack({ ok: true, id: msg.id });
  });

  socket.on('disconnect', (reason) => { /* 'transport close', 'ping timeout', 'client namespace disconnect', 'server namespace disconnect' */ });
});

httpServer.listen(3000);
```

- Validate every incoming payload (zod); never trust client-supplied user ids; derive identity from `socket.data`.
- Emit targets: `io.emit` (all), `io.to(room)`, `socket.to(room)` (all in room except sender), `socket.emit` (sender), `io.except(room)`, `io.of('/admin')` (namespace). Rooms are server-side only; clients cannot join themselves.
- Server-side push from HTTP handlers/jobs: export `io` (or an emitter) and call `io.to(`user:${id}`).emit(...)`. From other processes use `@socket.io/redis-emitter`.
- Acknowledgements: last argument callback; the server can also `await socket.timeout(5000).emitWithAck('event', data)`; clients can call `await socket.emitWithAck('event', data)`.
- Namespaces (`io.of('/admin')`) separate concerns and middleware; they share the underlying connection. Dynamic namespaces via `io.of(/^\/tenant-\d+$/)`.
- `connectionStateRecovery` replays missed events for brief disconnects (same process/adapter must support it: in-memory, Redis Streams, Postgres); still design clients to refetch state on `connect` when `socket.recovered` is false.
- `socket.volatile.emit` for high-frequency data that may be dropped (cursor positions); `socket.compress(false)` for already compressed binary; buffers/`Blob`/`ArrayBuffer` are sent as binary automatically.
- Disconnect misbehaving clients with `socket.disconnect(true)`; rate limit events per socket (`rate-limiter-flexible` keyed by `socket.data.userId`).

### Client

```ts
// lib/socket.ts
import { io, type Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '../shared/socket-events';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(import.meta.env.VITE_WS_URL, {
  autoConnect: false,
  withCredentials: true,
  auth: (cb) => cb({ token: getAccessToken() }),     // function form: re-evaluated on every (re)connect, so refreshed tokens are used
  reconnectionAttempts: Infinity,
  reconnectionDelayMax: 10_000,
  // transports: ['websocket'] only if long-polling must be disabled (then sticky sessions are not needed; but no fallback)
});

socket.on('connect_error', (err) => { if (err.message === 'unauthorized') refreshTokenOrLogout(); });
```

```tsx
// React usage
useEffect(() => {
  socket.connect();
  const onMessage = (msg: Message) => queryClient.setQueryData(['messages', msg.roomId], (old: Message[] = []) => [...old, msg]);
  const onConnect = () => { if (!socket.recovered) queryClient.invalidateQueries({ queryKey: ['messages'] }); };
  socket.on('chat:message', onMessage);
  socket.on('connect', onConnect);
  return () => { socket.off('chat:message', onMessage); socket.off('connect', onConnect); socket.disconnect(); };
}, []);
```

- Register listeners with named functions and remove them in cleanup (Strict Mode double-invokes effects). Never register listeners inside render or inside other handlers without cleanup (duplicate handlers after reconnect is the classic bug).
- One socket per app (module singleton or context provider); do not create a socket per component.
- Events emitted while disconnected are buffered and sent on reconnect; for user actions, prefer `emitWithAck` with `timeout()` and surface failures.
- `socket.io.on('reconnect_attempt', ...)` for connection-manager events; `socket.on('disconnect', reason)` where `'io server disconnect'` means the server kicked the client and it will not auto-reconnect (call `socket.connect()` after re-auth).
- Node/React Native clients: pass `extraHeaders` for cookies/tokens if needed; RN needs `transports: ['websocket']` in some environments.

### Scaling

- Multiple instances require (a) an adapter so rooms/broadcasts span processes and (b) sticky sessions when HTTP long-polling is enabled (each polling request must reach the same instance). With `transports: ['websocket']` only on the client, stickiness is unnecessary.
- Redis adapter: `io.adapter(createAdapter(pubClient, subClient))` from `@socket.io/redis-adapter` (ioredis or node-redis clients). Redis Streams adapter (`@socket.io/redis-streams-adapter`) also supports connection state recovery. Postgres adapter for stacks without Redis; cluster adapter + sticky module for Node `cluster` on one machine.
- Enable `perMessageDeflate` only if bandwidth matters (CPU cost); tune `pingInterval`/`pingTimeout` for mobile networks; put a reverse proxy with WebSocket upgrade headers (`Upgrade`, `Connection`) and a long `proxy_read_timeout`.
- Serverless and edge platforms cannot host Socket.IO servers; use a dedicated long-running service or a managed realtime provider.
- Monitor with `@socket.io/admin-ui` (protect it) and `io.engine.clientsCount`.

### Testing

```ts
// server handler test with real sockets (vitest/jest)
import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';

let io: Server, client: ClientSocket, httpServer: ReturnType<typeof createServer>;
beforeAll(async () => {
  httpServer = createServer();
  io = new Server(httpServer);
  registerHandlers(io);                                        // the app's handler setup
  await new Promise<void>((r) => httpServer.listen(() => r()));
  const { port } = httpServer.address() as AddressInfo;
  client = Client(`http://localhost:${port}`, { auth: { token: testToken } });
  await new Promise<void>((r) => client.on('connect', () => r()));
});
afterAll(() => { io.close(); client.disconnect(); });

it('acks a join', async () => {
  const res = await client.emitWithAck('chat:join', 'general');
  expect(res.ok).toBe(true);
});
```

- Test through a real server on an ephemeral port; use `emitWithAck` and promises instead of nested callbacks; use `vi.useFakeTimers()` carefully (heartbeats depend on timers).
- Unit-test pure handler logic (parse, authorise, persist) separately from socket plumbing.
- Client components: mock `lib/socket.ts` with an `EventEmitter`-based fake exposing `on/off/emit/emitWithAck`.

## Common tasks

### Add a new event

1. Add the signature to `ClientToServerEvents` or `ServerToClientEvents` (with ack type if request/response).
2. Server: validate payload, authorise via `socket.data`, persist, broadcast to the right room, ack.
3. Client: typed `socket.on` in an effect with cleanup, or `emitWithAck` in the action; update the client cache.
4. Test the handler end to end.

### Push to a specific user from an HTTP route

Join every connection to `user:${userId}` on connect; in the route handler `io.to(`user:${id}`).emit('notification', payload)`. With several processes use the Redis adapter or `@socket.io/redis-emitter` from the API process.

### Presence

Track `io.in(room).fetchSockets()` (adapter-aware) or a Redis set keyed by user with TTL refreshed on heartbeat; emit `presence:update` on join/leave/disconnect. Debounce rapid changes.

### Handle token expiry

Use the function form of `auth`, reject in middleware with `next(new Error('unauthorized'))`, and on the client refresh the token in `connect_error` then `socket.connect()`.

## Pitfalls

- Mismatched server/client major versions or a plain `ws` client connecting to Socket.IO.
- Listeners added in render or without cleanup: duplicates after each re-render/reconnect.
- Trusting payload `userId`; always use `socket.data` set in middleware.
- Multiple instances without an adapter: broadcasts reach only local sockets; without sticky sessions long-polling fails with 400 "Session ID unknown".
- CORS: `cors.origin` missing or `'*'` with `credentials: true` (invalid); client `withCredentials` mismatch.
- Proxies without WebSocket upgrade headers or with short idle timeouts, causing constant fallback to polling or disconnects.
- Emitting large payloads (> `maxHttpBufferSize`) or unbounded history on join; paginate.
- Using `socket.rooms` after disconnect (already cleared); capture rooms in a `disconnecting` listener.
- `io.emit` from inside a `connection` handler that should target one socket (`socket.emit`).
- Blocking the event loop in handlers (sync DB/crypto); heartbeats time out and clients disconnect.
- Query-string tokens; use `auth` option (not logged by proxies).

## Verification

```bash
npx tsc --noEmit            # shared event types enforce both sides
npm test                    # handler tests with real sockets on an ephemeral port
npm run build
curl -s "http://localhost:3000/socket.io/?EIO=4&transport=polling" | head -c 200   # server responds with handshake JSON (starts with 0{"sid":...)
```

Manually: open two browser tabs, verify broadcast/rooms; kill the server and confirm clients reconnect and resync; check the admin UI or logs for connection counts.

## References

- Socket.IO docs: https://socket.io/docs/v4/
- TypeScript (typed events): https://socket.io/docs/v4/typescript/
- Rooms and namespaces: https://socket.io/docs/v4/rooms/ , https://socket.io/docs/v4/namespaces/
- Middlewares and auth: https://socket.io/docs/v4/middlewares/
- Connection state recovery: https://socket.io/docs/v4/connection-state-recovery
- Adapters and scaling: https://socket.io/docs/v4/using-multiple-nodes/
- Testing: https://socket.io/docs/v4/testing/
