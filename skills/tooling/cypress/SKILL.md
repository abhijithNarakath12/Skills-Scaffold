---
name: cypress
description: Write, run and debug end-to-end and component tests with Cypress 13/14. Covers cypress.config, data-cy selectors, custom commands, cy.intercept for network stubbing and waiting, retry-ability, fixtures, session-based login, test isolation, and running in CI. Use when a project depends on cypress or has cypress.config.ts/js, or when asked to add or fix Cypress tests.
---

# Cypress

Assumes Cypress 13 or 14 with `cypress.config.ts` and TypeScript specs. Check the version with `npx cypress --version`.

## When to use

- Adding or fixing specs under `cypress/e2e/**/*.cy.ts` or component specs `*.cy.tsx`.
- Editing `cypress.config.ts`, `cypress/support/` (commands, e2e/component setup), fixtures.
- Debugging failing or flaky specs, network stubs, or CI runs.

## Project conventions to detect first

1. `cypress.config.ts`: `e2e.baseUrl`, `specPattern`, `supportFile`, `component.devServer` (framework and bundler), `retries`, `video`, `screenshotOnRunFailure`, `env`, `experimental*` flags.
2. Selector convention: `data-cy`, `data-test`, or `data-testid`; a `cy.getBySel` style command in `cypress/support/commands.ts`.
3. Custom commands and their type declarations (`cypress/support/index.d.ts` or `declare global { namespace Cypress { interface Chainable {...} } }`).
4. Auth strategy: `cy.session()` with a login command, API-based login, or seeded cookies; `testIsolation` setting.
5. Data setup: `cy.task` to seed a DB, `cy.request` to an API, fixtures in `cypress/fixtures/`.
6. Runner and CI: `npm run cy:open`, `cy:run`, `start-server-and-test`, Cypress Cloud (`--record`), the `cypress-io/github-action`, Docker images `cypress/browsers`.

## Core guidance

### Configuration

```ts
// cypress.config.ts
import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    specPattern: 'cypress/e2e/**/*.cy.{ts,tsx}',
    supportFile: 'cypress/support/e2e.ts',
    retries: { runMode: 2, openMode: 0 },
    video: false,
    viewportWidth: 1280,
    viewportHeight: 800,
    setupNodeEvents(on, config) {
      on('task', { 'db:seed': () => seed().then(() => null) });  // tasks must return a value or null
      return config;
    },
  },
  component: {
    devServer: { framework: 'react', bundler: 'vite' },
    specPattern: 'src/**/*.cy.tsx',
  },
});
```

- Keep `baseUrl` set so `cy.visit('/path')` works and Cypress does not reload on first visit.
- Put secrets in `cypress.env.json` (gitignored) or `CYPRESS_*` env vars, not in the config file.

### Selectors and commands

```ts
// cypress/support/commands.ts
Cypress.Commands.add('getBySel', (selector: string, ...args) =>
  cy.get(`[data-cy=${selector}]`, ...args),
);

Cypress.Commands.add('login', (email: string) => {
  cy.session(email, () => {
    cy.request('POST', '/api/test/login', { email }).then(({ body }) => {
      window.localStorage.setItem('token', body.token);
    });
  }, { cacheAcrossSpecs: true });
});
```

```ts
// cypress/support/index.d.ts
declare global {
  namespace Cypress {
    interface Chainable {
      getBySel(selector: string, options?: Partial<Loggable & Timeoutable>): Chainable<JQuery<HTMLElement>>;
      login(email: string): Chainable<void>;
    }
  }
}
export {};
```

- Select with `data-cy` attributes added to the app, or `cy.contains('button', 'Save')` / `cy.findByRole` (Testing Library) for user-facing text. Never select by CSS class, tag chains or generated IDs.
- Cypress commands are enqueued and async; do not assign their results to variables or mix with `await`. Use `.then()`, aliases (`.as('row')` then `cy.get('@row')`), or closures.
- Assertions retry until `defaultCommandTimeout` (4s) on the previous command; `cy.get('li').should('have.length', 3)` retries, `cy.get('li').then(els => expect(els).to.have.length(3))` does not.
- Chain assertions directly after queries: `cy.getBySel('status').should('be.visible').and('contain', 'Saved')`.
- `cy.wait(ms)` is banned except as a last resort documented inline; wait on aliases (`cy.wait('@getUsers')`) or assertions instead.

### Network

```ts
cy.intercept('GET', '/api/users*', { fixture: 'users.json' }).as('getUsers');
cy.intercept('POST', '/api/users', (req) => {
  expect(req.body).to.include({ name: 'Ada' });
  req.reply({ statusCode: 201, body: { id: 7, ...req.body } });
}).as('createUser');

cy.visit('/users');
cy.wait('@getUsers').its('response.statusCode').should('eq', 200);
```

- Register `cy.intercept` before the action that triggers the request (usually before `cy.visit`).
- Stub third-party and slow endpoints; let core app endpoints hit a real test backend when possible, and still alias them to `cy.wait` on.
- `cy.request` bypasses the UI for setup/teardown and auth; it is not intercepted.
- Use `req.continue()` to observe or modify a real request/response without fully stubbing.

### Test isolation and state

- `testIsolation` (default `true` since v12) clears the page, cookies, localStorage between tests; rely on `cy.session` to restore auth cheaply.
- Each test must set up its own data (`cy.task('db:seed')`, `cy.request`); never depend on a previous test.
- `beforeEach` over `before` for state; `after` hooks for cleanup are unreliable if the test fails midway.
- Keep tests short: one user flow each; split long journeys.

### Component tests

```tsx
import { Button } from './Button';
describe('Button', () => {
  it('fires onClick', () => {
    const onClick = cy.stub().as('onClick');
    cy.mount(<Button onClick={onClick}>Save</Button>);
    cy.contains('button', 'Save').click();
    cy.get('@onClick').should('have.been.calledOnce');
  });
});
```

`cy.mount` is provided by `cypress/support/component.ts` per framework (`cypress/react`, `cypress/vue`, `cypress/angular`). Wrap with providers (router, store, theme) in a custom mount.

## Common tasks

### Add Cypress to a project

```bash
npm i -D cypress start-server-and-test
npx cypress open      # scaffolds cypress/ and config on first run
```

Scripts: `"cy:open": "cypress open"`, `"cy:run": "cypress run"`, `"test:e2e": "start-server-and-test dev http://localhost:3000 cy:run"`. Add `cypress/videos`, `cypress/screenshots`, `cypress.env.json` to `.gitignore`. Create `cypress/tsconfig.json` with `"types": ["cypress", "node"]`.

### Run tests

```bash
npx cypress open                                   # interactive runner
npx cypress run                                    # headless, Electron
npx cypress run --browser chrome --spec "cypress/e2e/users/**"
npx cypress run --component
npx cypress run --env grepTags=@smoke              # with @cypress/grep
DEBUG=cypress:* npx cypress run                    # verbose logs
```

Filter single tests with `it.only` locally (never commit; `eslint-plugin-cypress`/`no-only-tests`).

### Debug a failing spec

1. `npx cypress open`, run the spec, click each command in the command log to time-travel the DOM snapshot; inspect intercepted requests.
2. Add `cy.pause()` or `.debug()` on a chain; use browser DevTools in the runner.
3. In CI, download `cypress/screenshots` and `cypress/videos` (enable `video: true` temporarily) or use Cypress Cloud.
4. Check for a selector matching multiple elements (`click()` requires one unless `{ multiple: true }`), or an assertion that does not retry.

### CI with GitHub Actions

```yaml
- uses: cypress-io/github-action@v6
  with:
    build: npm run build
    start: npm run start
    wait-on: 'http://localhost:3000'
    browser: chrome
- uses: actions/upload-artifact@v4
  if: failure()
  with: { name: cypress-screenshots, path: cypress/screenshots }
```

Parallelize with Cypress Cloud (`record: true`, `parallel: true`, `CYPRESS_RECORD_KEY`) or split specs across matrix jobs with `--spec` globs.

## Pitfalls

- Mixing `async/await` with Cypress commands or returning promises alongside commands; commands are not promises.
- Storing `cy.get()` results in a `const` and reusing them after the DOM re-renders leads to detached-element errors; re-query or alias.
- `cy.wait(2000)` hides races; use `cy.wait('@alias')` or an assertion.
- Conditional testing (`if (el.length) ...`) is unreliable because the DOM is still changing; make the app state deterministic instead.
- Visiting two different origins in one test requires `cy.origin()`.
- Intercept registered after the request fires never matches; move it before `cy.visit`/action.
- `before` hooks with login plus `testIsolation: true` lose state before the first `it`; use `cy.session` in `beforeEach`.
- Hard-coded waits and `defaultCommandTimeout` bumps across the whole suite instead of fixing the one slow step.
- Running Cypress against production or shared staging with data-mutating tests.
- Tasks in `setupNodeEvents` returning `undefined` fail; return `null`.

## Verification

```bash
npx cypress run                         # green headless
npx cypress run --spec <changed spec>   # new tests pass in isolation, run 2-3 times
npx tsc --noEmit -p cypress/tsconfig.json
npx eslint cypress                      # eslint-plugin-cypress if configured
```

## References

- Cypress docs: https://docs.cypress.io/
- Best practices: https://docs.cypress.io/app/core-concepts/best-practices
- Retry-ability: https://docs.cypress.io/app/core-concepts/retry-ability
- cy.intercept: https://docs.cypress.io/api/commands/intercept
- cy.session: https://docs.cypress.io/api/commands/session
- Component testing: https://docs.cypress.io/app/component-testing/get-started
- GitHub Action: https://github.com/cypress-io/github-action
