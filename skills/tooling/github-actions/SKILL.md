---
name: github-actions
description: Write, review and debug GitHub Actions workflows in .github/workflows. Covers triggers and filters, jobs and matrices, dependency caching, least-privilege permissions, secrets and OIDC, reusable workflows and composite actions, concurrency, artifacts, pinning actions by commit SHA, and debugging failed runs with the gh CLI. Use when editing ci.yml, release.yml or any workflow YAML, or when asked to set up or fix CI on GitHub.
---

# GitHub Actions

Assumes GitHub-hosted runners (`ubuntu-24.04`/`ubuntu-latest`), actions/checkout v4+, Node 20 runtime for JavaScript actions, and `gh` CLI 2.x authenticated.

## When to use

- Creating or editing files under `.github/workflows/`, `.github/actions/`, or `.github/dependabot.yml`.
- Adding CI (lint, test, build), release pipelines, deployments, scheduled jobs.
- Diagnosing failed or slow runs, flaky jobs, permission errors, cache misses.

## Project conventions to detect first

1. Existing workflows: naming, trigger style, runner labels (self-hosted?), Node/Python/Go setup actions and versions, cache usage, how secrets are referenced.
2. Package manager and scripts: `package.json` scripts, lockfile, `Makefile`, `pyproject.toml`; CI should call the same commands developers run.
3. Branch model: default branch name, release branches, tag format (`v1.2.3`), required status checks (`gh api repos/{owner}/{repo}/branches/main/protection`).
4. Action pinning policy: SHA-pinned (`uses: actions/checkout@<sha> # v4.2.2`) with Dependabot `github-actions` updates, or tag-pinned. Follow the existing policy; prefer SHA pinning for new workflows.
5. Reusable pieces: `.github/workflows/*.yml` with `workflow_call`, `.github/actions/<name>/action.yml` composite actions, org-level shared workflows.
6. Environments (`environment: production`) with required reviewers, and deployment secrets scoped to them.

## Core guidance

### Minimal CI workflow

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    strategy:
      fail-fast: false
      matrix:
        node: [20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test -- --ci
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: test-output-${{ matrix.node }}
          path: coverage/
          retention-days: 7
```

### Triggers

- `pull_request` runs with read-only `GITHUB_TOKEN` for forks; `pull_request_target` runs with write access in the base repo context and must never check out or execute PR code.
- Use `paths:`/`paths-ignore:` and `branches:` filters to avoid needless runs; note that required checks skipped by path filters block merges unless configured.
- `workflow_dispatch` with `inputs:` for manual runs; `schedule:` uses UTC cron and runs only on the default branch.
- `push: tags: ['v*']` for releases; `release: types: [published]` if releases are created in the UI.

### Permissions and secrets

- Set `permissions:` at the top level to the minimum (`contents: read`) and raise per job (`pull-requests: write`, `id-token: write`, `packages: write`) only where needed.
- Use OIDC (`id-token: write` + `aws-actions/configure-aws-credentials`, `google-github-actions/auth`, `azure/login`) instead of long-lived cloud keys in secrets.
- Secrets are not available to workflows triggered from forks on `pull_request`; design fork-safe checks.
- Never echo secrets; GitHub masks known secrets but not derived values. Use `::add-mask::` for derived values.
- Do not interpolate untrusted input (`${{ github.event.pull_request.title }}`, issue bodies, branch names) directly into `run:` scripts; pass via `env:` and quote: `env: TITLE: ${{ github.event.pull_request.title }}` then `"$TITLE"`.

### Pin actions

```yaml
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
```

Resolve a SHA with `gh api repos/actions/checkout/git/ref/tags/v4.2.2 --jq .object.sha` (dereference annotated tags with `git/tags/<sha>` if the type is `tag`). Add Dependabot to keep them updated:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
```

### Caching

- Prefer the built-in `cache:` input of `setup-node`, `setup-python`, `setup-go`, `setup-java` (keyed on the lockfile).
- For custom caches use `actions/cache@v4` with a lockfile-hash key and a `restore-keys` prefix fallback. Cache is scoped to the branch and falls back to the default branch; caches over 10 GB per repo are evicted.
- Docker builds: `docker/build-push-action` with `cache-from: type=gha` and `cache-to: type=gha,mode=max`.

### Reusable workflows and composite actions

```yaml
# .github/workflows/reusable-test.yml
on:
  workflow_call:
    inputs:
      node-version: { type: string, default: '22' }
    secrets:
      NPM_TOKEN: { required: false }
jobs:
  test:
    runs-on: ubuntu-latest
    steps: [...]
```

Call with `jobs.test.uses: ./.github/workflows/reusable-test.yml` and `with:`/`secrets: inherit`. Use a composite action (`runs: using: composite`) for a reusable sequence of steps inside a job; each `run:` step needs `shell: bash`.

### Jobs, outputs, artifacts

- `needs:` for ordering; pass data with `outputs:` on the job and `echo "name=value" >> "$GITHUB_OUTPUT"` in steps.
- `$GITHUB_ENV` for env vars across later steps, `$GITHUB_STEP_SUMMARY` for Markdown summaries.
- `actions/upload-artifact@v4` / `download-artifact@v4`: artifact names must be unique per run (v4 is immutable); use matrix values in the name and `merge-multiple: true` on download.
- Set `timeout-minutes` on every job (default is 360).
- `if: always()` to run cleanup even on failure; `if: github.event_name != 'pull_request'` to skip publishing on PRs.

## Common tasks

### Add CI to a repo

1. Discover commands from `package.json`/`Makefile`/`pyproject.toml`.
2. Create `.github/workflows/ci.yml` using the minimal template, with the setup action matching the language and lockfile caching.
3. Pin actions per repo policy; add `permissions: contents: read` and `concurrency`.
4. Push a branch and open a PR; watch the run: `gh run watch` or `gh pr checks --watch`.

### Add a release workflow

1. Trigger on `push: tags: ['v*']` (or `release: published`).
2. `permissions: contents: write` for creating releases, `packages: write` for GHCR, `id-token: write` for npm provenance (`npm publish --provenance`) or PyPI trusted publishing.
3. Build once, upload artifacts, then create the release: `gh release create "$GITHUB_REF_NAME" dist/* --generate-notes`.
4. Protect with `environment: release` if secrets require approval.

### Deploy with OIDC to AWS

```yaml
permissions: { id-token: write, contents: read }
steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::123456789012:role/github-deploy
      aws-region: eu-west-1
```

Confirm the IAM trust policy limits `sub` to the repo and branch/environment.

### Debug a failed run

```bash
gh run list --workflow ci.yml --limit 10
gh run view <run-id> --log-failed            # only failed steps' logs
gh run view <run-id> --job <job-id> --log
gh run rerun <run-id> --failed               # rerun failed jobs
gh run rerun <run-id> --debug                # rerun with step debug logging
gh workflow view ci.yml --yaml
```

- Enable debug logs by setting repository secret/variable `ACTIONS_STEP_DEBUG=true` or rerunning with `--debug`.
- `Resource not accessible by integration`: a missing `permissions:` scope or a fork PR.
- Cache miss on every run: key includes something that changes per run (`github.sha`, timestamp) or the lockfile is not committed.
- Run locally with `act` (https://github.com/nektos/act) for quick iteration; it does not emulate everything (OIDC, environments).

### Lint workflows

```bash
actionlint                      # https://github.com/rhysd/actionlint
zizmor .github/workflows        # security audit, if installed
```

## Pitfalls

- `pull_request_target` + `actions/checkout` with `ref: ${{ github.event.pull_request.head.sha }}` executes untrusted code with write tokens.
- Script injection via `${{ }}` inside `run:`; always route untrusted values through `env:`.
- Top-level `permissions: write-all` or omitting `permissions` (defaults can be write) violates least privilege.
- Tags are mutable: `uses: some/action@v1` can change underneath you; SHA-pin for anything with secrets access.
- `ubuntu-latest` moves between major versions; pin `ubuntu-24.04` for reproducibility if tooling is sensitive.
- `cancel-in-progress: true` on `main` pushes can cancel a deployment mid-way; restrict it to PRs.
- `continue-on-error: true` hides real failures; use it only for known-flaky optional jobs and surface the result.
- Matrix `include` entries without the base keys create extra jobs rather than extending existing ones.
- Job outputs are strings; `if: needs.build.outputs.changed == 'true'` needs quotes.
- `secrets.GITHUB_TOKEN` pushes do not trigger other workflows; use a GitHub App token or PAT if a follow-on workflow must run.
- `upload-artifact@v4` fails on duplicate names across matrix jobs; include the matrix key.

## Verification

```bash
actionlint                                      # syntax, expressions, shellcheck of run: blocks
gh workflow list && gh workflow view ci.yml     # workflow registered and parses
gh pr checks --watch                            # checks pass on the PR
gh run view --log-failed                        # if red, read the failing step only
```

Confirm `permissions:` is set on every workflow and that no secret is logged.

## References

- Workflow syntax: https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions
- Events that trigger workflows: https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows
- Security hardening: https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions
- OIDC: https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect
- Reusing workflows: https://docs.github.com/en/actions/sharing-automations/reusing-workflows
- gh run: https://cli.github.com/manual/gh_run
- actionlint: https://github.com/rhysd/actionlint
