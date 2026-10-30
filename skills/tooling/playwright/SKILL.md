---
name: playwright
description: Write, run and debug end-to-end and component tests with Playwright (@playwright/test 1.4x+ or pytest-playwright). Covers locators and auto-waiting, web-first assertions, page objects, custom fixtures, playwright.config projects, tracing and the UI/inspector debuggers, CI setup, and flaky-test discipline. Use when a project depends on @playwright/test or playwright/pytest-playwright, has playwright.config.ts/js, or when asked to add browser tests.
---

# Playwright

Assumes `@playwright/test` 1.45+ (TypeScript examples) and notes for `pytest-playwright`. Check the version with `npx playwright --version`; browsers must match it (`npx playwright install`).

## When to use

- Adding or fixing E2E specs under `e2e/`, `tests/`, or `playwright/`; component tests with `@playwright/experimental-ct-*`.
- Editing `playwright.config.ts` (projects, baseURL, webServer, retries, reporters).
- Debugging flaky or failing browser tests, reading traces, running in CI.

## Project conventions to detect first

1. `playwright.config.ts`: `testDir`, `baseURL`, `projects` (browsers, devices, auth setup project), `webServer`, `use.trace`/`screenshot`/`video`, `retries`, `workers`, `reporter`.
2. Fixture setup: `tests/fixtures.ts` extending `test`, storage-state auth (`playwright/.auth/user.json`), global setup/teardown.
3. Page objects or helpers: `pages/`, `support/`, naming (`LoginPage`), how locators are centralised.
4. Test IDs: `data-testid` (default) or a custom attribute via `use.testIdAttribute`; prefer role/text locators unless the repo standardises on test IDs.
5. Runner: `npm run test:e2e`, `npx playwright test`, `pytest` with `--browser`; CI workflow and whether browsers are installed via `npx playwright install --with-deps` or the Docker image `mcr.microsoft.com/playwright`.
6. Environment: seeded test data, API helpers for setup, feature flags, `.env.test`.

## Core guidance

### Configuration

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' }, dependencies: ['setup'] },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
```

### Locators and assertions

```ts
import { test, expect } from '@playwright/test';

test('user can create a project', async ({ page }) => {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Name').fill('Alpha');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Alpha' })).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/\w+/);
});
```

- Locator priority: `getByRole` > `getByLabel`/`getByPlaceholder` > `getByText` > `getByTestId` > CSS/XPath. Role locators test accessibility too.
- Locators are lazy and auto-wait; never store `ElementHandle`s or use `page.$`.
- Use web-first assertions (`await expect(locator).toBeVisible()`, `toHaveText`, `toHaveCount`, `toHaveValue`, `toBeEnabled`) which retry until timeout. Avoid `expect(await locator.isVisible()).toBe(true)` which does not retry.
- Narrow with `locator.filter({ hasText })`, `.and()`, `.or()`, `locator.nth(i)` only when order is meaningful.
- Do not use `page.waitForTimeout`. Wait for state (`expect(...)`), navigation (`page.waitForURL`), or responses (`page.waitForResponse`).

### Fixtures and page objects

```ts
// e2e/fixtures.ts
import { test as base } from '@playwright/test';
import { ProjectsPage } from './pages/projects-page';

export const test = base.extend<{ projectsPage: ProjectsPage }>({
  projectsPage: async ({ page }, use) => {
    const p = new ProjectsPage(page);
    await p.goto();
    await use(p);
  },
});
export { expect } from '@playwright/test';
```

```ts
// e2e/pages/projects-page.ts
import type { Page, Locator } from '@playwright/test';
export class ProjectsPage {
  readonly newButton: Locator;
  constructor(private readonly page: Page) {
    this.newButton = page.getByRole('button', { name: 'New project' });
  }
  async goto() { await this.page.goto('/projects'); }
  async create(name: string) {
    await this.newButton.click();
    await this.page.getByLabel('Name').fill(name);
    await this.page.getByRole('button', { name: 'Create' }).click();
  }
}
```

- Page objects hold locators and actions, not assertions; keep assertions in tests.
- Worker-scoped fixtures (`[async ({}, use) => {...}, { scope: 'worker' }]`) for expensive resources shared across a worker's tests.
- Authentication: a `setup` project logs in once and saves `storageState`; tests reuse it. Use `test.use({ storageState: ... })` per file for other roles.

### Network and data

- `page.route('**/api/flags', route => route.fulfill({ json: {...} }))` to stub third-party or flaky endpoints; keep core flows against the real backend.
- Seed data through the API (`request` fixture) or DB helpers in `beforeEach`, not through the UI.
- Make tests independent: each creates its own data with unique names (`test.info().testId` or a UUID) so parallel runs do not collide.

### Flaky-test discipline

- A test that fails intermittently is a bug; do not raise `retries` to hide it. Reproduce with `npx playwright test --repeat-each 20 <file>` and inspect the trace.
- Common causes: asserting on non-retrying values, racing navigation (`await Promise.all([page.waitForURL(...), button.click()])`), shared data between tests, animations (set `use: { reducedMotion: 'reduce' }` and assert after `toBeVisible`; disable long CSS transitions in the app's test build if they still race), timezone/locale (`use.timezoneId`, `use.locale`).
- Mark known-flaky tests `test.fixme()` with an issue link rather than leaving them red.

## Common tasks

### Add Playwright to a project

```bash
npm init playwright@latest      # scaffolds config, example test, GitHub workflow
npx playwright install --with-deps chromium
```

Then set `baseURL`, `webServer`, and remove the example test. Python: `pip install pytest-playwright && playwright install`.

### Run tests

```bash
npx playwright test                              # all projects
npx playwright test e2e/projects.spec.ts -g "create"
npx playwright test --project=chromium --headed
npx playwright test --ui                         # interactive UI mode, time travel
npx playwright test --debug                      # inspector, step through
npx playwright test --trace on                   # force traces
npx playwright show-report                       # open HTML report
npx playwright show-trace test-results/**/trace.zip
npx playwright codegen http://localhost:3000     # record a starting point; clean it up afterwards
```

Python: `pytest --browser chromium --headed --tracing retain-on-failure`, `--slowmo 500`, `PWDEBUG=1 pytest`.

### Debug a failing test

1. Open the HTML report or trace (`show-trace`); check the action timeline, DOM snapshots, console and network.
2. Re-run with `--headed --debug` or `--ui` and inspect the locator with the Pick Locator tool.
3. Check for a locator matching multiple elements (strict mode violation): narrow with role/name/filter.
4. If timing related, replace any `waitForTimeout`/non-retrying check with a web-first assertion.

### Component tests

- `npm init playwright@latest -- --ct` installs `@playwright/experimental-ct-react` (or `-vue`, `-svelte`); tests `mount(<Component />)` and use the same locators/assertions. Config is `playwright-ct.config.ts`. Check https://playwright.dev/docs/test-components for framework support.

### CI (GitHub Actions)

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 22, cache: npm }
- run: npm ci
- run: npx playwright install --with-deps
- run: npx playwright test
- uses: actions/upload-artifact@v4
  if: ${{ !cancelled() }}
  with: { name: playwright-report, path: playwright-report/, retention-days: 14 }
```

Shard large suites: `npx playwright test --shard=${{ matrix.shard }}/4` and merge reports with `npx playwright merge-reports --reporter html ./all-blob-reports` (use the `blob` reporter per shard).

## Pitfalls

- `page.waitForTimeout` and `sleep` in tests mask races and add minutes to the suite.
- Non-retrying assertions (`expect(await locator.textContent()).toBe(...)`) fail intermittently; use `toHaveText`.
- Strict mode violation: a locator resolving to more than one element throws on action; narrow it instead of `.first()` unless order is guaranteed.
- Tests sharing a logged-in user and mutating the same records collide under `fullyParallel`.
- Browser binaries out of sync with the package after upgrading `@playwright/test`; rerun `npx playwright install`.
- `test.only` committed; set `forbidOnly: !!process.env.CI`.
- `webServer.reuseExistingServer: true` in CI points tests at a stale server.
- Clicking before hydration in SPA/SSR apps: assert that an element is enabled or that a network idle/hydration marker exists before interacting.
- Assuming `goto` waits for all XHRs; it waits for `load` by default. Assert on the UI, not on `goto` resolving.
- Running a different browser than production users: include WebKit/Firefox projects if the app supports them.

## Verification

```bash
npx playwright test                       # green locally with the project's browsers
npx playwright test --repeat-each 5 <changed spec>   # new/changed tests are stable
npx tsc --noEmit -p e2e/tsconfig.json     # if tests have their own tsconfig
npx eslint e2e                            # eslint-plugin-playwright if configured
```

## References

- Playwright docs: https://playwright.dev/docs/intro
- Locators: https://playwright.dev/docs/locators
- Assertions: https://playwright.dev/docs/test-assertions
- Fixtures: https://playwright.dev/docs/test-fixtures
- Authentication: https://playwright.dev/docs/auth
- Trace viewer: https://playwright.dev/docs/trace-viewer
- CI: https://playwright.dev/docs/ci
- Python: https://playwright.dev/python/docs/intro
