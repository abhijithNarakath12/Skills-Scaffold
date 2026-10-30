# NestJS request lifecycle and where each concern belongs

## Order

```
incoming request
  -> middleware          (global app.use, then module-level consumer.apply)
  -> guards              (global -> controller -> handler)
  -> interceptors (pre)  (global -> controller -> handler)
  -> pipes               (global -> controller -> handler -> parameter)
  -> handler
  -> interceptors (post) (handler -> controller -> global; RxJS pipe on the returned observable)
  -> exception filters   (handler -> controller -> global; first matching @Catch wins)
response
```

Exceptions thrown anywhere after middleware go to filters. Exceptions in middleware go to the underlying adapter (Express/Fastify) error handling, not Nest filters.

## Where to put what

| Concern | Use | Notes |
|---|---|---|
| Raw body, request id, CORS, helmet | middleware / `app.use` | runs before DI-aware layers |
| Authentication, authorization | guard | return `true`/`false` or throw `UnauthorizedException`/`ForbiddenException` |
| Input parsing and validation | pipe | `ValidationPipe`, `ParseIntPipe`, custom `PipeTransform` |
| Response shaping, timing, caching, timeouts | interceptor | `map()`, `tap()`, `timeout()` from rxjs |
| Entity serialization (`@Exclude`) | `ClassSerializerInterceptor` | entities must be class instances, not plain rows |
| Error shaping, ORM error mapping | exception filter | `@Catch(QueryFailedError)` or `@Catch()` catch-all |
| Business rules | service | throw `HttpException` subclasses |

## Registering global providers with DI

Register through the module so injected dependencies resolve:

```ts
@Module({
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_PIPE, useValue: new ValidationPipe({ whitelist: true, transform: true }) },
    { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
```

`app.useGlobalGuards(new X())` works only for classes without injected dependencies and is invisible to `Test.createTestingModule`.

## Metadata-driven decorators

```ts
export const Roles = Reflector.createDecorator<string[]>();

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride(Roles, [ctx.getHandler(), ctx.getClass()]);
    if (!roles) return true;
    const { user } = ctx.switchToHttp().getRequest();
    return roles.some((r) => user?.roles?.includes(r));
  }
}
```

Apply with `@Roles(['admin'])` on handlers or controllers.

## Exception filter example

```ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly adapterHost: HttpAdapterHost) {}
  catch(exception: unknown, host: ArgumentsHost) {
    const { httpAdapter } = this.adapterHost;
    const ctx = host.switchToHttp();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const body = exception instanceof HttpException ? exception.getResponse() : { statusCode: 500, message: 'Internal server error' };
    httpAdapter.reply(ctx.getResponse(), body, status);
  }
}
```

Using `HttpAdapterHost` keeps the filter adapter-agnostic (Express and Fastify).

## Testing implications

- Unit tests: instantiate the provider via `Test.createTestingModule` with mocks; pipeline layers are not involved.
- e2e tests: `moduleRef.createNestApplication()` builds the full pipeline for providers registered via `APP_*` tokens; anything applied with `app.useGlobal*` in `main.ts` must be repeated in the test.
- To test a guard in isolation, build an `ExecutionContext` mock (`createMock<ExecutionContext>()` from `@golevelup/ts-jest`) and call `canActivate` directly.
