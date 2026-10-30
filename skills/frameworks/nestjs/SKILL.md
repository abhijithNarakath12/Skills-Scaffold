---
name: nestjs
description: Build and maintain NestJS 10/11 backends with modules, providers, controllers, dependency injection, pipes, guards, interceptors, exception filters, DTO validation (class-validator), ConfigModule, TypeORM or Prisma integration, the Nest CLI and testing with @nestjs/testing and supertest. Use when a project depends on @nestjs/core or when editing *.module.ts, *.controller.ts, *.service.ts, *.dto.ts or *.spec.ts files.
---

# NestJS

Assumes NestJS 10 or 11 on TypeScript 5 with the default Express adapter. Fastify adapter (`@nestjs/platform-fastify`) changes request/response types; check which one `main.ts` uses.

## When to use

- Adding or changing modules, controllers, services/providers, DTOs, guards, pipes, interceptors or filters.
- Wiring configuration, database (TypeORM, Prisma, Mongoose), queues, scheduling, WebSockets or microservices into a Nest app.
- Writing unit tests with `@nestjs/testing` or e2e tests with `supertest`.
- Using the Nest CLI to generate code.
- For raw Express/Fastify apps without Nest decorators, use those skills instead.

## Project conventions to detect first

1. Nest version in `package.json` (`@nestjs/core`). Nest 11 requires Node 20+, uses Express 5 by default (async errors handled; path syntax `*splat`), and changed `CacheModule`/`@nestjs/cache-manager` to cache-manager v6. Nest 10 ships Express 4.
2. HTTP adapter: `NestFactory.create(AppModule)` (Express) vs `NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter())`.
3. ORM: `@nestjs/typeorm` + `typeorm`, `@prisma/client` (usually a custom `PrismaService`), `@nestjs/mongoose`, `drizzle-orm`, `mikro-orm`. Follow the existing data-access pattern.
4. Validation: `class-validator` + `class-transformer` with a global `ValidationPipe` (most common); or `nestjs-zod`/`zod` pipes. Check `main.ts` for `app.useGlobalPipes`.
5. Config: `@nestjs/config` with `ConfigModule.forRoot({ isGlobal: true, validationSchema })` (Joi) or a `validate` function; where `.env` files live.
6. Layout: `src/<feature>/<feature>.module.ts|controller.ts|service.ts`, `dto/`, `entities/`; `src/common/` for shared guards/filters/interceptors; monorepo mode (`nest-cli.json` with `projects`) and `libs/`.
7. Auth: `@nestjs/passport` + `passport-jwt`, or `@nestjs/jwt` with a custom `AuthGuard`; look for `@Public()` decorators and a global `APP_GUARD`.
8. API docs: `@nestjs/swagger` with `@ApiProperty` decorators or the CLI plugin in `nest-cli.json` (`compilerOptions.plugins`).
9. Tests: `jest` (default, `*.spec.ts` unit, `test/*.e2e-spec.ts` e2e) or `vitest` via `unplugin-swc`.

## Core guidance

### Modules and dependency injection

- One module per feature; declare `controllers`, `providers`, `imports`, and `exports` explicitly. A provider is only injectable in other modules if its module `exports` it and the consumer `imports` the module.
- Mark cross-cutting modules `@Global()` sparingly (config, logger, database).
- Constructor injection with `private readonly`. Avoid property injection and `ModuleRef` lookups except for dynamic cases.
- Circular dependencies between modules or providers: restructure first; `forwardRef(() => X)` is the last resort.
- Custom providers: `{ provide: TOKEN, useValue }`, `useFactory` with `inject: [ConfigService]`, `useClass`, `useExisting`. Use string or `Symbol` tokens for non-class dependencies and inject with `@Inject(TOKEN)`.
- Scope: default singleton. `Scope.REQUEST` creates per-request instances and bubbles up to everything that depends on it; avoid unless needed (tenant context), prefer `AsyncLocalStorage` (`nestjs-cls`).
- Lifecycle hooks: `OnModuleInit`, `OnApplicationBootstrap`, `OnModuleDestroy`, `OnApplicationShutdown`; call `app.enableShutdownHooks()` in `main.ts` for graceful shutdown.

### Controllers and DTOs

```ts
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.users.findOne(id); // throws NotFoundException inside the service
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }
}
```

- Return plain values or promises; Nest serializes to JSON. Only inject `@Res()` for streaming or redirects (then you own the response; or use `@Res({ passthrough: true })`).
- DTOs are classes (not interfaces) so decorators and runtime validation work:

```ts
export class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsOptional() @IsIn(['admin', 'user']) role?: 'admin' | 'user';
}
export class UpdateUserDto extends PartialType(CreateUserDto) {} // from @nestjs/mapped-types or @nestjs/swagger
```

- Global pipe in `main.ts`: `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }))`.
- Query params: a DTO class with `@Type(() => Number)` or `enableImplicitConversion`; never trust raw `@Query()` strings as numbers.

### Request pipeline

Order for an incoming request: middleware -> guards -> interceptors (before) -> pipes -> handler -> interceptors (after) -> exception filters.

- **Middleware** (`NestMiddleware`, configured in `configure(consumer: MiddlewareConsumer)`) for raw request concerns (logging, raw body).
- **Guards** (`CanActivate`) for auth/authorization. Read metadata with `Reflector` (`@SetMetadata`, or `Reflector.createDecorator()`), e.g. `@Roles('admin')`. Register global guards via `{ provide: APP_GUARD, useClass: JwtAuthGuard }` so DI works.
- **Interceptors** (`NestInterceptor`) for response mapping, timing, caching, `ClassSerializerInterceptor` (honours `@Exclude()`/`@Expose()` on entities).
- **Pipes** for transformation/validation: built-ins `ParseIntPipe`, `ParseUUIDPipe`, `ParseEnumPipe`, `DefaultValuePipe`.
- **Exception filters** (`@Catch()`) to shape error responses. Throw `HttpException` subclasses (`NotFoundException`, `BadRequestException`, `ConflictException`, `UnauthorizedException`) from services; map ORM errors in one filter rather than in each service.

### Configuration

```ts
ConfigModule.forRoot({
  isGlobal: true,
  envFilePath: ['.env.local', '.env'],
  validationSchema: Joi.object({ DATABASE_URL: Joi.string().required(), PORT: Joi.number().default(3000) }),
});
// consume
constructor(private readonly config: ConfigService<Env, true>) {}
const url = this.config.get('DATABASE_URL', { infer: true });
```

Use `registerAs('db', () => ({...}))` namespaces and inject with `@Inject(dbConfig.KEY) private db: ConfigType<typeof dbConfig>` for typed, grouped config. Use `forRootAsync` + `useFactory` + `inject: [ConfigService]` when a module needs config at import time (TypeORM, JWT, Bull).

### Database

- TypeORM: `TypeOrmModule.forRootAsync` once, `TypeOrmModule.forFeature([User])` per module, inject `@InjectRepository(User) private repo: Repository<User>`. Keep `synchronize: false` outside local dev; generate migrations with `typeorm migration:generate` (project usually has an npm script and a `data-source.ts`).
- Prisma: a `PrismaService extends PrismaClient implements OnModuleInit` exported from a `PrismaModule`; run `npx prisma migrate dev` and `npx prisma generate` after schema changes.
- Keep transactions in services (`dataSource.transaction(async (manager) => ...)` or `prisma.$transaction`). Do not leak repositories into controllers.

### Logging and errors

- Use Nest `Logger` (`private readonly logger = new Logger(UsersService.name)`) or a structured logger (`nestjs-pino`) set via `app.useLogger()`.
- Do not catch and re-throw generic `Error`; throw the correct `HttpException` or let a filter map it.
- Enable `app.enableCors()` with explicit origins, `helmet()` as Express middleware, and a global prefix `app.setGlobalPrefix('api')` if the project uses one. Versioning: `app.enableVersioning({ type: VersioningType.URI })` + `@Controller({ path: 'users', version: '1' })`.

## Common tasks

### Generate a feature

```bash
npx nest g resource users --no-spec   # module + controller + service + DTOs + entity (choose REST)
npx nest g module users && npx nest g controller users && npx nest g service users
npx nest g guard common/guards/roles && npx nest g interceptor common/interceptors/timeout
```

The CLI updates the parent module's `imports` automatically. Check `nest-cli.json` for `sourceRoot` and monorepo projects (`nest g service users --project api`).

### Add an endpoint

1. Add/extend a DTO in `dto/` with class-validator decorators (and `@ApiProperty` if Swagger is used without the CLI plugin).
2. Add the handler to the controller with the HTTP decorator, parameter decorators and pipes.
3. Implement the logic in the service; throw `NotFoundException` etc.
4. Unit test the service with mocked repositories; add an e2e test for the route.

### Protect routes with JWT

1. `npm i @nestjs/jwt @nestjs/passport passport passport-jwt` (or just `@nestjs/jwt`).
2. `JwtModule.registerAsync({ useFactory: (c: ConfigService) => ({ secret: c.get('JWT_SECRET'), signOptions: { expiresIn: '1h' } }), inject: [ConfigService] })`.
3. Guard that verifies the bearer token, attaches `request.user`, and honours `@Public()` via `Reflector.getAllAndOverride(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])`.
4. Register as `APP_GUARD`; add `@Public()` to login/health routes.
5. Create a `@CurrentUser()` param decorator with `createParamDecorator`.

### Unit test a service

```ts
const module = await Test.createTestingModule({
  providers: [UsersService, { provide: getRepositoryToken(User), useValue: { findOneBy: jest.fn() } }],
}).compile();
const service = module.get(UsersService);
```

Use `.overrideProvider(X).useValue(mock)` on an imported real module when that is simpler. For `useMocker(createMock)` see `@golevelup/ts-jest`.

### e2e test

```ts
const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(PrismaService).useValue(testPrisma)
  .compile();
app = moduleRef.createNestApplication();
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true })); // mirror main.ts
await app.init();
await request(app.getHttpServer()).get('/users/1').expect(200);
```

Global pipes/filters set in `main.ts` are not applied automatically in tests; replicate them or register them via `APP_PIPE`/`APP_FILTER` providers in `AppModule` so both paths share them. Run with `npm run test:e2e` (default config `test/jest-e2e.json`).

## Pitfalls

- Provider not found: the module that owns it does not `exports` it, or the consumer forgot to `imports` the module.
- DTOs declared as `interface` or `type`: decorators cannot attach, validation silently passes.
- `ValidationPipe` without `whitelist: true` lets unexpected fields through; without `transform: true` DTOs are plain objects and `@Type` conversions do not happen.
- Using `@Res()` and then also returning a value (response hangs or double-sends).
- `emitDecoratorMetadata` and `experimentalDecorators` must be on in `tsconfig.json`; SWC/esbuild builds need the matching plugin (`unplugin-swc` with `jsc.transform.decoratorMetadata`).
- `Scope.REQUEST` on a widely used provider turns the whole dependency graph request-scoped and hurts performance.
- Business logic in controllers or guards; keep it in services for testability.
- Catching errors in services and returning `null`, hiding failures from filters.
- TypeORM `synchronize: true` in production; Prisma client not regenerated after schema change.
- Nest 11 + Express 5: route wildcards must be named (`*splat`), and `cache-manager` v5 stores are incompatible.

## Verification

```bash
cat package.json | jq .scripts
npm run lint              # eslint + prettier
npx tsc --noEmit -p tsconfig.json
npm test                  # jest unit (*.spec.ts)
npm run test:e2e          # jest e2e (test/*.e2e-spec.ts)
npm run build             # nest build -> dist/
npm run start:dev         # watch mode; curl localhost:3000/<prefix>
```

## References

- [references/request-lifecycle.md](references/request-lifecycle.md): pipeline order, where to put each concern, and a checklist for global providers.
- NestJS docs: https://docs.nestjs.com
- Nest 11 migration guide: https://docs.nestjs.com/migration-guide
- class-validator decorators: https://github.com/typestack/class-validator#validation-decorators
- Testing: https://docs.nestjs.com/fundamentals/testing
