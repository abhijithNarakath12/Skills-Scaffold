---
name: graphql
description: Design and implement GraphQL APIs and clients - schema design (SDL, nullability, connections), resolvers, N+1 avoidance with DataLoader, Apollo Server and GraphQL Yoga on the server, Apollo Client/urql/Relay on the client, graphql-codegen for types, cursor pagination, error handling, and security (depth/complexity limits, persisted queries, introspection). Load when a project has .graphql/.gql files or depends on graphql, @apollo/server, @apollo/client, graphql-yoga, urql, graphene, strawberry-graphql or ariadne.
---

# GraphQL

Assumes GraphQL spec (June 2018 / October 2021) with `graphql` 16 in JS, Apollo Server 4, GraphQL Yoga 5, Apollo Client 3.x, urql 4, graphql-codegen 5. Python: Strawberry (type-first), Graphene 3, Ariadne (schema-first). The schema-design and security guidance applies to all.

## When to use

- Adding types, fields, queries, mutations or subscriptions to a schema.
- Writing resolvers, batching with DataLoader, auth in context, error handling.
- Consuming an API from React/Vue/Svelte with Apollo Client, urql or Relay; cache updates after mutations.
- Generating TypeScript types from the schema and operations.
- Hardening a public GraphQL endpoint.

## Project conventions to detect first

1. Server library: `@apollo/server` (Apollo Server 4; v3 `apollo-server*` is EOL), `graphql-yoga`, `mercurius` (Fastify), `@nestjs/graphql`, `pothos`/`nexus` (code-first), Python `strawberry`, `graphene`, `ariadne`.
2. Schema style: SDL files (`schema.graphql`, `*.graphqls`, `typeDefs` strings) vs code-first builders. Modular: `@graphql-tools/merge`/`loadFiles`, GraphQL Modules, federation (`@apollo/subgraph` with `@key` directives, Apollo Router/Gateway).
3. Codegen: `codegen.ts`/`codegen.yml` with plugins (`typescript`, `typescript-resolvers`, `typescript-operations`, `typescript-react-apollo`, `typescript-urql`) or the `client` preset (`graphql()` tagged documents, `gql.tada` as an alternative). Generated files location and whether they are committed.
4. Client: `@apollo/client` (check `InMemoryCache` `typePolicies`), `urql` (`@urql/exchange-graphcache`), `relay-runtime` + compiler (`__generated__` folders). Vue: `@vue/apollo-composable` or `@urql/vue`.
5. Operations location: colocated `*.graphql` files, `gql` template literals, or `graphql()` from the client preset.
6. DataLoader usage: `dataloader` package, loaders created per request in `context`.
7. Auth: context builder reading headers; directive-based (`@auth`), `graphql-shield`, or checks in resolvers.
8. Security middleware: `graphql-depth-limit`, `graphql-query-complexity`, `graphql-armor`, Yoga plugins, persisted queries, CSRF prevention, introspection disabled in production.
9. Testing: `executeOperation` (Apollo), `yoga.fetch` / `buildHTTPExecutor`, `msw` with `graphql.query` handlers on the client, `MockedProvider` (Apollo).

## Core guidance

### Schema design

```graphql
type Query {
  node(id: ID!): Node
  user(id: ID!): User
  posts(first: Int = 20, after: String, filter: PostFilter): PostConnection!
}

type Mutation {
  createPost(input: CreatePostInput!): CreatePostPayload!
}

interface Node { id: ID! }

type User implements Node {
  id: ID!
  email: String!
  posts(first: Int = 10, after: String): PostConnection!
}

type Post implements Node {
  id: ID!
  title: String!
  author: User!
  publishedAt: DateTime
}

type PostConnection { edges: [PostEdge!]!  pageInfo: PageInfo!  totalCount: Int }
type PostEdge { cursor: String!  node: Post! }
type PageInfo { hasNextPage: Boolean!  hasPreviousPage: Boolean!  startCursor: String  endCursor: String }

input CreatePostInput { title: String!  body: String! }

type CreatePostPayload { post: Post  userErrors: [UserError!]! }
type UserError { field: [String!]  message: String!  code: String! }

scalar DateTime
```

- Nullability is the API contract: non-null (`!`) for fields that always exist; nullable where the resolver may fail or data is optional so a failure does not null the parent. Lists: `[Post!]!` almost always.
- Mutations: one `input` object argument, a payload type with the mutated entity and `userErrors` for expected failures (validation, business rules); reserve GraphQL `errors` for unexpected/system errors.
- Name mutations verb-first (`createPost`, `publishPost`), avoid generic `updatePost` with a hundred optional fields when the domain has specific actions.
- Pagination: Relay-style connections (`first/after`, `last/before`, opaque cursors) for lists that can grow; simple `limit/offset` only for small admin tables.
- Global object identification (`Node` interface, globally unique `ID`) makes client caching work (Apollo normalizes by `__typename` + `id`; Relay requires it).
- Evolve additively: add fields, deprecate with `@deprecated(reason: "...")`, never rename or remove without a sunset period. No versioning in URLs.
- Custom scalars (`DateTime`, `JSON`, `URL`) from `graphql-scalars` rather than hand-written ones.
- Enums for closed sets; interfaces/unions for polymorphism (`union SearchResult = User | Post`), with `__resolveType` resolvers.

### Resolvers and context (Apollo Server 4 / Yoga)

```ts
// server.ts (Apollo Server 4 standalone)
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import DataLoader from 'dataloader';

interface Context { user: User | null; loaders: ReturnType<typeof createLoaders>; db: Db }

const createLoaders = (db: Db) => ({
  userById: new DataLoader<string, User | null>(async (ids) => {
    const rows = await db.user.findMany({ where: { id: { in: [...ids] } } });
    const byId = new Map(rows.map((u) => [u.id, u]));
    return ids.map((id) => byId.get(id) ?? null);          // same order and length as ids
  }),
});

const resolvers: Resolvers<Context> = {                         // type from codegen typescript-resolvers
  Query: {
    user: (_p, { id }, ctx) => ctx.loaders.userById.load(id),
    posts: (_p, args, ctx) => paginatePosts(ctx.db, args),
  },
  Post: {
    author: (post, _a, ctx) => ctx.loaders.userById.load(post.authorId),   // no N+1
  },
  Mutation: {
    createPost: async (_p, { input }, ctx) => {
      if (!ctx.user) throw new GraphQLError('Unauthenticated', { extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } } });
      const errors = validate(input);
      if (errors.length) return { post: null, userErrors: errors };
      return { post: await ctx.db.post.create({ data: { ...input, authorId: ctx.user.id } }), userErrors: [] };
    },
  },
};

const server = new ApolloServer<Context>({ typeDefs, resolvers, introspection: process.env.NODE_ENV !== 'production' });
await startStandaloneServer(server, {
  context: async ({ req }) => ({ user: await authenticate(req.headers.authorization), loaders: createLoaders(db), db }),
});
```

- Create DataLoaders per request (in `context`), never module-level, or caches leak across users. The batch function must return results in the same order as keys, with `null`/`Error` for misses.
- Field resolvers should be thin: fetch via loaders or services; keep business logic in a service layer reused by REST/jobs.
- Mapper types: when DB rows differ from GraphQL types (e.g. `authorId` vs `author`), configure codegen `mappers` so resolver parent types are the DB shape.
- Yoga equivalent: `createYoga({ schema: createSchema({ typeDefs, resolvers }), context: ({ request }) => ({ ... }) })` served via `node:http`, Fastify, Next.js route handlers, or edge runtimes. Yoga ships GraphiQL, SSE subscriptions, and plugins (`@graphql-yoga/plugin-*`).
- Subscriptions: `graphql-ws` (WebSocket) for Apollo; Yoga uses SSE by default. `PubSub` in-memory only for a single instance; Redis pubsub (`graphql-redis-subscriptions`) for multiple.
- Express integration (Apollo): `expressMiddleware(server, { context })` after `cors()` and `express.json()`.

### Errors

- Throw `GraphQLError` with `extensions.code` (`UNAUTHENTICATED`, `FORBIDDEN`, `BAD_USER_INPUT`, `NOT_FOUND`, `INTERNAL_SERVER_ERROR`). Apollo adds `extensions.code` conventions; Yoga masks unexpected errors by default (`maskedErrors`), so wrap expected ones in `GraphQLError`.
- Hide stack traces and internal messages in production (`includeStacktraceInErrorResponses: false` in Apollo 4).
- Partial data: a nullable field that throws returns `null` with an entry in `errors`; clients should check both `data` and `errors`.
- Expected domain failures go in `userErrors` on mutation payloads, not in `errors`.

### Security

- Disable introspection and GraphQL Playground/landing page in production unless the API is public by design.
- Limit query depth (`graphql-depth-limit`), complexity (`graphql-query-complexity` with `estimators`, or `graphql-armor` which bundles depth, cost, alias, directive and token limits for Apollo and Yoga), aliases and batching size (`allowBatchedHttpRequests: false` or cap).
- Enforce `first`/`last` maximums on connections (e.g. 100) in the resolver.
- Persisted/trusted documents (Apollo `usePersistedQueries`/safelisting, Yoga `usePersistedOperations`, Relay persisted queries, urql `persistedExchange`) so only known operations run.
- CSRF prevention: Apollo 4 enables `csrfPrevention` by default (requires `content-type: application/json` or a preflight header); keep it. Yoga has `@graphql-yoga/plugin-csrf-prevention`.
- Authn in context, authz per field/object (directive, shield, or resolver checks); never trust `input` ids without ownership checks.
- Rate limit by operation/cost, log operation names (`operationName`), set timeouts, bound input list sizes.

### Clients

Apollo Client 3:

```ts
const client = new ApolloClient({
  link: from([authLink, errorLink, new HttpLink({ uri: '/graphql' })]),
  cache: new InMemoryCache({
    typePolicies: { Query: { fields: { posts: relayStylePagination(['filter']) } } },
  }),
});
// component (types from codegen)
const { data, loading, error, fetchMore } = useQuery(PostsDocument, { variables: { first: 20 } });
const [createPost] = useMutation(CreatePostDocument, {
  update(cache, { data }) { cache.modify({ fields: { posts: (existing, { DELETE }) => DELETE } }) },   // or refetchQueries: ['Posts']
});
```

- Normalized cache keys from `__typename` + `id` (`keyFields` for other ids). After mutations: return the changed entity with `id` (auto-merged), use `refetchQueries` for lists, or `cache.modify`/`updateQuery` for precise updates. `optimisticResponse` for instant UI.
- `fetchPolicy`: `cache-first` default; `cache-and-network` for freshness; `network-only` rarely. Error handling via `errorPolicy: 'all'` to receive partial data.
- SSR: `getDataFromTree`/Next.js `@apollo/experimental-nextjs-app-support` (App Router).

urql:

- `createClient({ url, exchanges: [cacheExchange, fetchExchange] })` (document cache) or `@urql/exchange-graphcache` (normalized, with `updates`/`optimistic` config and `keys`). `useQuery({ query, variables, pause })`, `useMutation`; `reexecuteQuery({ requestPolicy: 'network-only' })` to refresh. Small bundle, good for SSR with `ssrExchange`.

Relay:

- Requires the Relay compiler (`relay-compiler`, `relay.config.js`), fragments colocated with components (`useFragment`), `usePaginationFragment` with `@connection`, `useLazyLoadQuery`/`usePreloadedQuery`. Follow the generated artifact conventions; never hand-edit `__generated__`.

### Codegen

```ts
// codegen.ts
import type { CodegenConfig } from '@graphql-codegen/cli';
const config: CodegenConfig = {
  schema: './schema.graphql',                      // or http://localhost:4000/graphql
  documents: ['src/**/*.{ts,tsx,graphql}'],
  generates: {
    './src/gql/': { preset: 'client' },            // client: typed graphql() documents
    './src/generated/resolvers.ts': { plugins: ['typescript', 'typescript-resolvers'], config: { contextType: '../context#Context', mappers: { Post: '../db#PostRow' } } },
  },
};
export default config;
```

Run `npx graphql-codegen` (add `--watch` in dev). Commit generated files or generate in CI and build; be consistent with the repo.

### Python servers

- Strawberry: `@strawberry.type` classes with resolvers as methods, `strawberry.Schema(query=Query)`, ASGI integration for FastAPI (`GraphQLRouter`); DataLoader via `strawberry.dataloader.DataLoader` created in `context_getter`; extensions for `QueryDepthLimiter`, `MaxTokensLimiter`, `MaxAliasesLimiter`.
- Ariadne: SDL in `.graphql` files, `QueryType()`/`ObjectType()` bindings, `make_executable_schema`, `ariadne.asgi.GraphQL` app; `aiodataloader` for batching.
- Graphene 3: `graphene.ObjectType`, `graphene.Schema(query=Query)`; `graphene-django` for Django models. Prefer Strawberry for new Python projects unless the codebase already uses Graphene.

## Common tasks

### Add a field

1. Add to SDL (nullable unless guaranteed); add resolver (use a loader if it hits the DB per parent).
2. Run codegen; fix type errors in resolvers.
3. Update client operations that need it; run codegen on the client; write a test.

### Add a mutation

Input type + payload with `userErrors`; resolver checks auth, validates, calls service, returns entity with `id`. Client: `useMutation` with cache update or `refetchQueries`; optimistic response if UX needs it.

### Fix an N+1

Enable query logging; find the field resolver issuing one query per parent; replace with a per-request DataLoader keyed by the parent's FK (or a `JOIN`/`include` on the parent query when one-level deep).

### Paginate a list

Implement a Relay connection (`first/after` with an opaque base64 cursor of the sort key), cap `first`, return `pageInfo`. Client: `relayStylePagination` (Apollo) or `usePaginationFragment` (Relay) or graphcache `relayPagination` resolver (urql).

### Test a server

```ts
const res = await server.executeOperation({ query: 'query { user(id: "1") { email } }' }, { contextValue: makeContext({ user: admin }) });
assert(res.body.kind === 'single'); expect(res.body.singleResult.data?.user.email).toBe('a@b.c');
```

Yoga: `const res = await yoga.fetch('http://yoga/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) })`. Client components: `msw` `graphql.query('Posts', () => HttpResponse.json({ data }))` or Apollo `MockedProvider`.

## Pitfalls

- Resolving relations per parent without DataLoader (N+1); or a module-level loader leaking data between requests.
- Non-null fields that can fail, nulling entire responses; make them nullable or guarantee them.
- Returning REST-style error objects in `errors` for validation failures; use `userErrors` payloads.
- Introspection and GraphiQL exposed in production; no depth/complexity limits on a public endpoint.
- Clients forgetting `id`/`__typename` in selections, so cache normalisation and mutation auto-updates fail.
- Mutation returns an entity but lists are not refetched/updated: new items do not appear.
- Codegen out of date with the schema; always re-run after schema changes (add a CI check that generated files are unchanged).
- Offset pagination on large or frequently changing lists; duplicates and gaps.
- Mixing `apollo-server` v3 packages with `@apollo/server` v4 APIs.
- Subscriptions with in-memory PubSub behind a load balancer with several instances.
- Deeply nested input types for "update everything" mutations; split by use case.
- Resolvers that accept `any` parent types because codegen `mappers` are missing.

## Verification

```bash
npx graphql-codegen                 # regenerates types; fails on invalid documents against the schema
npx tsc --noEmit
npm run lint                        # @graphql-eslint/eslint-plugin if configured (operations validated against schema)
npm test                            # executeOperation / yoga.fetch server tests; msw/MockedProvider client tests
npx graphql-inspector diff schema.graphql origin/main:schema.graphql   # breaking-change check (if installed)
```

Python: `pytest`, `strawberry export-schema app.schema:schema > schema.graphql` to review the SDL.

## References

- GraphQL spec and learn: https://graphql.org/learn/
- Apollo Server 4: https://www.apollographql.com/docs/apollo-server/
- GraphQL Yoga: https://the-guild.dev/graphql/yoga-server/docs
- DataLoader: https://github.com/graphql/dataloader
- Relay cursor connections spec: https://relay.dev/graphql/connections.htm
- Apollo Client caching: https://www.apollographql.com/docs/react/caching/overview
- urql: https://commerce.nearform.com/open-source/urql/docs/
- graphql-codegen: https://the-guild.dev/graphql/codegen/docs/getting-started
- GraphQL Armor (security): https://escape.tech/graphql-armor/docs/getting-started
- Strawberry: https://strawberry.rocks/docs
