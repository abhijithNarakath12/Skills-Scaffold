---
name: spring-boot
description: Build and maintain Spring Boot 3.x services on Java 17/21 (or Kotlin), covering starters, controller/service/repository layering, Spring Data JPA, Bean Validation, @RestControllerAdvice exception handling, @ConfigurationProperties and profiles, Spring Security basics, and testing with @SpringBootTest, @WebMvcTest, @DataJpaTest and Testcontainers under Maven or Gradle. Use when a project depends on org.springframework.boot or when editing @SpringBootApplication, @RestController, @Service, @Entity, application.yml or pom.xml/build.gradle.
---

# Spring Boot

Assumes Spring Boot 3.2+ (Spring Framework 6, Jakarta EE 9+ `jakarta.*` packages, Java 17 minimum, Java 21 recommended for virtual threads). Boot 2.x used `javax.*` and Spring Security's `WebSecurityConfigurerAdapter`, both gone in 3.x.

## When to use

- Adding REST endpoints, services, JPA entities/repositories, validation, exception handlers, configuration or security rules.
- Setting up tests (`@WebMvcTest`, `@DataJpaTest`, `@SpringBootTest`, Testcontainers).
- Build/dependency work in `pom.xml` or `build.gradle(.kts)`.
- Not for plain Spring Framework without Boot, or Quarkus/Micronaut.

## Project conventions to detect first

1. Boot version and build tool: `pom.xml` parent `spring-boot-starter-parent` version, or `build.gradle(.kts)` `id("org.springframework.boot") version`. Java version in `<java.version>`/`toolchain`. Wrapper present (`./mvnw`, `./gradlew`): always use it.
2. Language: Java or Kotlin (`kotlin("plugin.spring")`, `kotlin("plugin.jpa")`, `jackson-module-kotlin`).
3. Starters in use: `web` vs `webflux` (reactive: `Mono`/`Flux`, R2DBC); `data-jpa` vs `data-jdbc` vs `data-mongodb`; `security`, `oauth2-resource-server`, `validation`, `actuator`, `cache`; `springdoc-openapi-starter-webmvc-ui`; `flyway`/`liquibase`; `lombok`/`mapstruct`.
4. Package layout: layered (`controller/`, `service/`, `repository/`, `domain/`, `dto/`) vs feature packages (`order/`, `customer/`); all under the `@SpringBootApplication` package so component scanning finds them.
5. Config files: `application.yml` vs `.properties`, profiles (`application-dev.yml`, `spring.profiles.active`), `@ConfigurationProperties` records, `.env`/secrets injection.
6. Persistence: JPA entity conventions (Lombok vs records for DTOs, `@Version`, auditing `@CreatedDate`), schema managed by Flyway/Liquibase (`src/main/resources/db/migration/V1__init.sql`) vs `spring.jpa.hibernate.ddl-auto`.
7. Error format: `ProblemDetail` (RFC 9457, `spring.mvc.problemdetails.enabled=true`) vs custom error DTO in `@RestControllerAdvice`.
8. Tests: JUnit 5, `spring-boot-starter-test` (AssertJ, Mockito, MockMvc), `spring-boot-testcontainers` + `@ServiceConnection` (Boot 3.1+), `@MockitoBean` (Boot 3.4+; `@MockBean` is deprecated), `RestAssured`, `WireMock`, ArchUnit.
9. Formatting/static analysis: Spotless, Checkstyle, Error Prone, SonarQube, `ktlint`/`detekt`.

## Core guidance

### Layering

```java
@RestController
@RequestMapping("/api/orders")
@RequiredArgsConstructor
class OrderController {
    private final OrderService orderService;

    @GetMapping("/{id}")
    OrderResponse get(@PathVariable Long id) {
        return orderService.get(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    OrderResponse create(@Valid @RequestBody CreateOrderRequest request) {
        return orderService.create(request);
    }
}

@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
class OrderService {
    private final OrderRepository orders;
    private final OrderMapper mapper;

    OrderResponse get(Long id) {
        return orders.findById(id).map(mapper::toResponse).orElseThrow(() -> new OrderNotFoundException(id));
    }

    @Transactional
    OrderResponse create(CreateOrderRequest req) { ... }
}

interface OrderRepository extends JpaRepository<Order, Long> {
    @EntityGraph(attributePaths = "items")
    Optional<Order> findWithItemsById(Long id);
    List<Order> findByCustomerIdAndStatus(Long customerId, OrderStatus status);
}
```

- Controllers: HTTP concerns only (mapping, validation, status codes). Services: transactions and business rules. Repositories: data access. Entities never cross the HTTP boundary; map to request/response records (MapStruct or hand-written).
- Constructor injection only (`final` fields; Lombok `@RequiredArgsConstructor` or explicit constructor). No `@Autowired` on fields.
- Request/response DTOs as Java `record`s with validation annotations.
- Use `ResponseEntity` only when you need headers or dynamic status; otherwise return the body and annotate `@ResponseStatus`.

### Spring Data JPA

- Entities: `@Entity`, `@Id @GeneratedValue(strategy = GenerationType.IDENTITY)` (or `SEQUENCE` for batching), `@Version` for optimistic locking; implement `equals/hashCode` on the id carefully (or use business keys); avoid Lombok `@Data` on entities (`toString`/`hashCode` with lazy collections).
- Default `@ManyToOne(fetch = FetchType.LAZY)`; `@OneToMany` is lazy already. Fix N+1 with `@EntityGraph`, `JOIN FETCH` in `@Query`, or projections; enable `spring.jpa.open-in-view=false` so lazy loading outside a transaction fails fast rather than silently issuing queries from the view layer.
- Derived queries for simple cases; `@Query("select o from Order o where ...")` JPQL for complex ones; `Specification` or Querydsl for dynamic filters; `@Modifying @Query` for bulk updates (clears the persistence context with `clearAutomatically = true`).
- Pagination: accept `Pageable` in controllers (`@PageableDefault(size = 20)`), return `Page<T>`; limit max page size with `spring.data.web.pageable.max-page-size`.
- Schema: Flyway/Liquibase migrations in `src/main/resources/db/migration`; `spring.jpa.hibernate.ddl-auto=validate` in all non-local profiles.
- `@Transactional` on service methods (class-level `readOnly = true`, override on writers). It only works on public methods called from another bean (proxy-based); self-invocation bypasses it.

### Validation

- `spring-boot-starter-validation` (Hibernate Validator). Annotate DTO fields (`@NotBlank`, `@Email`, `@Positive`, `@Size`, `@Valid` on nested), add `@Valid` on `@RequestBody`/`@ModelAttribute`, and `@Validated` on the controller class for `@PathVariable`/`@RequestParam` constraints.
- Custom constraints: `@Constraint(validatedBy = ...)` + `ConstraintValidator`. Cross-field rules go on the record type or in the service.
- Failed body validation throws `MethodArgumentNotValidException`; parameter validation throws `ConstraintViolationException` (or `HandlerMethodValidationException` in Spring 6.1+ method validation). Handle both.

### Exception handling

```java
@RestControllerAdvice
class ApiExceptionHandler {
    @ExceptionHandler(OrderNotFoundException.class)
    ProblemDetail notFound(OrderNotFoundException ex) {
        var pd = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
        pd.setTitle("Order not found");
        return pd;
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ProblemDetail invalid(MethodArgumentNotValidException ex) {
        var pd = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Validation failed");
        pd.setProperty("errors", ex.getBindingResult().getFieldErrors().stream()
            .map(e -> Map.of("field", e.getField(), "message", e.getDefaultMessage())).toList());
        return pd;
    }
}
```

- Alternatively extend `ResponseEntityExceptionHandler` to inherit handling of framework exceptions, or throw `ErrorResponseException`.
- Map `DataIntegrityViolationException` -> 409, `OptimisticLockingFailureException` -> 409, `AccessDeniedException` -> 403 (security handles it if thrown before the controller).
- Never expose stack traces: `server.error.include-stacktrace=never`, `server.error.include-message=never` in prod.

### Configuration and profiles

```java
@ConfigurationProperties(prefix = "app.payments")
@Validated
public record PaymentsProperties(@NotBlank String baseUrl, @DurationUnit(ChronoUnit.SECONDS) Duration timeout) {}

@SpringBootApplication
@ConfigurationPropertiesScan
class Application { ... }
```

- Typed `@ConfigurationProperties` records over scattered `@Value`. Enable with `@ConfigurationPropertiesScan` or `@EnableConfigurationProperties(...)`. Add `spring-boot-configuration-processor` for IDE metadata.
- Profiles: `application-{profile}.yml`; activate with `SPRING_PROFILES_ACTIVE=prod` or `--spring.profiles.active=prod`. Multi-document YAML with `spring.config.activate.on-profile`.
- Secrets via environment variables (relaxed binding: `APP_PAYMENTS_BASE_URL`), Vault, or cloud config; never committed.
- Conditional beans: `@ConditionalOnProperty`, `@Profile("!test")`.

### Security basics

```java
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
class SecurityConfig {
    @Bean
    SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.csrf(csrf -> csrf.disable())                       // stateless APIs only
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health", "/api/auth/**").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/public/**").permitAll()
                .anyRequest().authenticated())
            .oauth2ResourceServer(oauth -> oauth.jwt(Customizer.withDefaults()));
        return http.build();
    }
}
```

- Lambda DSL and `SecurityFilterChain` beans; `WebSecurityConfigurerAdapter` is gone.
- JWT resource server via `spring.security.oauth2.resourceserver.jwt.issuer-uri` or `jwk-set-uri`; map scopes/roles with a `JwtAuthenticationConverter`.
- Method security `@PreAuthorize("hasRole('ADMIN')")` on services; `PasswordEncoder` bean (`PasswordEncoderFactories.createDelegatingPasswordEncoder()`) for form/password login.
- Keep CSRF enabled for browser session apps; CORS via `CorsConfigurationSource` bean, not controller-level `@CrossOrigin("*")` on authenticated endpoints.

### Observability and runtime

- Actuator: expose `health`, `info`, `metrics`, `prometheus` deliberately (`management.endpoints.web.exposure.include`); secure everything else.
- Logging via SLF4J (`@Slf4j` or `LoggerFactory`), structured output (`logging.structured.format.console=ecs`, Boot 3.4+) when shipping to a log stack. Never `System.out`.
- Java 21: `spring.threads.virtual.enabled=true` for virtual threads on the servlet stack.
- Graceful shutdown: `server.shutdown=graceful` + `spring.lifecycle.timeout-per-shutdown-phase`.
- HTTP clients: `RestClient` (Boot 3.2+) or `WebClient`; `RestTemplate` is maintenance mode. Declarative `@HttpExchange` interfaces are available.

## Common tasks

### Add a REST resource

1. Entity + Flyway migration (`V<n>__create_orders.sql`).
2. `JpaRepository` interface with needed finders (`@EntityGraph` for collections).
3. Request/response records with validation; mapper.
4. `@Service` with `@Transactional` boundaries and domain exceptions.
5. `@RestController` with mappings and `@Valid`.
6. Handler in `@RestControllerAdvice` for new exceptions.
7. `@WebMvcTest` for the controller (mock service), `@DataJpaTest` for custom queries, one `@SpringBootTest` happy path with Testcontainers.

### Add configuration

1. Record with `@ConfigurationProperties(prefix = "app.x")` + `@Validated`.
2. Defaults in `application.yml`; environment-specific values in profile files or env vars.
3. Inject the record where needed; unit-test binding with `@ConfigurationPropertiesScan` in a `@SpringBootTest(properties = ...)` or `Binder` directly.

### Write tests

```java
@WebMvcTest(OrderController.class)
class OrderControllerTest {
    @Autowired MockMvc mvc;
    @MockitoBean OrderService orderService;   // @MockBean on Boot < 3.4

    @Test
    void returns404WhenMissing() throws Exception {
        given(orderService.get(1L)).willThrow(new OrderNotFoundException(1L));
        mvc.perform(get("/api/orders/1")).andExpect(status().isNotFound());
    }
}

@SpringBootTest(webEnvironment = RANDOM_PORT)
@Testcontainers
class OrderIntegrationTest {
    @Container @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");
    @Autowired TestRestTemplate rest;   // or WebTestClient (needs spring-webflux on the classpath)
    ...
}
```

- `@DataJpaTest` uses an embedded DB by default; add `@AutoConfigureTestDatabase(replace = NONE)` + Testcontainers to test against the real engine.
- `@WebMvcTest` loads security too; add `@WithMockUser` or `@AutoConfigureMockMvc(addFilters = false)` deliberately.
- Keep `@SpringBootTest` count low (context startup cost); reuse contexts by keeping the same configuration across tests.

### Run and build

```bash
./mvnw spring-boot:run -Dspring-boot.run.profiles=dev   # or ./gradlew bootRun --args='--spring.profiles.active=dev'
./mvnw -q verify                                         # compile, test, package
./gradlew build
./mvnw spring-boot:build-image                           # OCI image via Buildpacks
java -jar target/*.jar --spring.profiles.active=prod
```

## Pitfalls

- Field injection and `@Autowired` everywhere; circular dependencies hidden until startup.
- `@Transactional` on private methods or self-invoked methods (no proxy -> no transaction).
- `spring.jpa.open-in-view` left at default `true`: lazy loading leaks into controllers/serialization and hides N+1.
- Returning entities from controllers: Jackson infinite recursion on bidirectional relations, accidental exposure of fields, lazy-init exceptions.
- `ddl-auto=update` in production instead of migrations.
- Lombok `@Data`/`@EqualsAndHashCode` on entities with collections.
- `javax.*` imports in a Boot 3 project (compile errors); mismatched Testcontainers/Spring versions outside the Boot BOM.
- `@MockBean` on Boot 3.4+ (deprecated; use `@MockitoBean`) or mocking repositories in `@SpringBootTest` instead of using Testcontainers.
- Catching exceptions in controllers instead of letting `@RestControllerAdvice` handle them.
- Hard-coded `permitAll()` ordering mistakes: more specific matchers must come before `anyRequest()`.
- Exposing all actuator endpoints publicly.

## Verification

```bash
./mvnw -q verify            # or ./gradlew check  (unit + integration tests, static analysis plugins)
./mvnw spotless:check       # if Spotless configured; ./gradlew spotlessCheck
./mvnw dependency:tree      # resolve version conflicts; ./gradlew dependencies
./mvnw spring-boot:run      # then curl -i localhost:8080/actuator/health
./mvnw flyway:info          # if Flyway plugin configured; otherwise check logs for migration output
```

## References

- [references/testing-slices.md](references/testing-slices.md): choosing between test slices, Testcontainers setup and context-caching tips.
- Spring Boot reference: https://docs.spring.io/spring-boot/reference/
- Spring Boot 3 migration guide: https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.0-Migration-Guide
- Spring Data JPA: https://docs.spring.io/spring-data/jpa/reference/
- Spring Security: https://docs.spring.io/spring-security/reference/
- Testcontainers with Spring Boot: https://docs.spring.io/spring-boot/reference/testing/testcontainers.html
