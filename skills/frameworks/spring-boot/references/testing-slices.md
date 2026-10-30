# Spring Boot testing: slices, Testcontainers and context caching

## Choosing the test type

| Need | Annotation | Loads | Speed |
|---|---|---|---|
| Pure logic | none (JUnit + Mockito) | nothing | fastest |
| Controller mapping, validation, serialization, security rules | `@WebMvcTest(XController.class)` | MVC + advice + security filters; services mocked | fast |
| Reactive controller | `@WebFluxTest` | WebFlux + `WebTestClient` | fast |
| JPA queries, entity mappings | `@DataJpaTest` | JPA, repositories, embedded DB (or Testcontainers) | medium |
| JDBC/JOOQ/Mongo | `@JdbcTest`, `@JooqTest`, `@DataMongoTest` | matching slice | medium |
| JSON mapping | `@JsonTest` | Jackson | fast |
| HTTP client code | `@RestClientTest(XClient.class)` + `MockRestServiceServer` | RestClient/RestTemplate builders | fast |
| End-to-end with real wiring | `@SpringBootTest(webEnvironment = RANDOM_PORT)` | full context | slowest |

Use slices by default; reserve `@SpringBootTest` for a few vertical tests.

## Mocks in slices

- Boot 3.4+: `@MockitoBean` and `@MockitoSpyBean` (from `org.springframework.test.context.bean.override.mockito`). Boot 3.0-3.3: `@MockBean`/`@SpyBean`.
- `@WebMvcTest` includes `@ControllerAdvice`, `Filter`, `WebMvcConfigurer`, `Converter`, `HandlerInterceptor`, `JacksonModule` beans and Spring Security configuration, but not `@Service`/`@Component`; mock what the controller needs.
- Security in `@WebMvcTest`: `@WithMockUser(roles = "ADMIN")`, `with(jwt().authorities(...))` from `spring-security-test` for resource servers, or `@AutoConfigureMockMvc(addFilters = false)` to skip filters entirely.

## MockMvc example with JSON

```java
mvc.perform(post("/api/orders")
        .contentType(MediaType.APPLICATION_JSON)
        .content("""
            {"customerId": 1, "items": [{"sku": "A1", "qty": 2}]}
            """)
        .with(csrf()))
   .andExpect(status().isCreated())
   .andExpect(jsonPath("$.id").isNumber())
   .andExpect(jsonPath("$.items[0].sku").value("A1"));
```

Spring 6.2+ also offers `MockMvcTester` with AssertJ-style assertions (`assertThat(mvc.get().uri("/api/orders/1")).hasStatusOk()`).

## Testcontainers

```java
@SpringBootTest
@Testcontainers
class RepositoryIT {
    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");
}
```

- `@ServiceConnection` (Boot 3.1+) replaces `@DynamicPropertySource` wiring for supported containers (PostgreSQL, MySQL, MongoDB, Redis, Kafka, RabbitMQ, Elasticsearch, etc.). For others, use `@DynamicPropertySource static void props(DynamicPropertyRegistry r)`.
- Dependencies: `spring-boot-testcontainers`, `org.testcontainers:junit-jupiter`, `org.testcontainers:postgresql` (versions from the Boot BOM).
- Share one container across test classes: declare it `static` in an abstract base class, or use a singleton container started in a static initializer without `@Container` (never stopped; reused for the JVM). Enable `testcontainers.reuse.enable=true` in `~/.testcontainers.properties` for faster local runs with `.withReuse(true)`.
- `@DataJpaTest` + Testcontainers requires `@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)`.
- Development-time containers: a `TestXApplication` in `src/test/java` with `SpringApplication.from(Application::main).with(TestcontainersConfiguration.class).run(args)`; run via `./gradlew bootTestRun` or `./mvnw spring-boot:test-run`.

## Context caching

Spring caches `ApplicationContext` instances keyed by configuration (annotations, properties, mocks, profiles). Each unique combination starts a new context, which dominates test time.

- Keep `@SpringBootTest` classes identical in `properties`, `@ActiveProfiles`, `@MockitoBean` sets and `@TestPropertySource`.
- Put shared setup in an abstract base class (`@SpringBootTest @Testcontainers @ActiveProfiles("test")`).
- Avoid `@DirtiesContext` unless the test mutates singleton state.
- Log context count with `logging.level.org.springframework.test.context.cache=DEBUG`.

## Transactional tests

- `@DataJpaTest` and `@Transactional` tests roll back after each test; `saveAndFlush` or `TestEntityManager.flush()` to force SQL and catch constraint violations.
- For `@SpringBootTest` HTTP tests, the request runs in another thread; test transactions do not cover it. Clean data explicitly (`@Sql(scripts = "/cleanup.sql", executionPhase = AFTER_TEST_METHOD)`) or truncate tables in `@AfterEach`.

## Assertions and fixtures

- AssertJ (`assertThat`) is on the classpath via `spring-boot-starter-test`; prefer it over Hamcrest.
- `@Sql("/fixtures/orders.sql")` to seed data; `@SqlConfig` for separators.
- `OutputCaptureExtension` to assert on logs; `@TestConfiguration` for test-only beans; `@Import(TestClock.class)` to fix time via a `Clock` bean (inject `Clock` in production code rather than calling `Instant.now()`).
