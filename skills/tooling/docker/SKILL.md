---
name: docker
description: Write and review Dockerfiles and docker compose files, and build, run and debug containers. Covers multi-stage builds, layer caching, non-root users, .dockerignore, healthchecks, image size, compose for local development, debugging running containers and image security scanning. Use when a project has a Dockerfile, docker-compose.yml/compose.yaml or .dockerignore, or when asked to containerize an app.
---

# Docker

Assumes Docker Engine 24+ with BuildKit (default), Compose v2 (`docker compose`, not `docker-compose`), and the Dockerfile `# syntax=docker/dockerfile:1` frontend.

## When to use

- Creating or changing a `Dockerfile`, `Dockerfile.*`, `compose.yaml` / `docker-compose.yml`, or `.dockerignore`.
- Containerizing an application, shrinking an image, or fixing a slow or failing build.
- Running, inspecting or debugging containers locally or in CI.

## Project conventions to detect first

1. Existing `Dockerfile*` files: base image family (`debian`, `alpine`, `distroless`, `ubi`), stage names, and whether a `# syntax=` line is present. Keep the same base family unless asked.
2. `compose.yaml` / `docker-compose.yml`: service names, profiles, networks, volumes, `env_file`, and any `docker-compose.override.yml`. Prefer `compose.yaml` for new files; do not add a `version:` key (obsolete in Compose v2).
3. `.dockerignore`: if missing, create one before the first build (see Common tasks).
4. Build pipeline: `Makefile`, `package.json` scripts, CI workflows that call `docker build`/`docker buildx build`, registry and tag conventions, target platforms (`--platform linux/amd64,linux/arm64`).
5. Runtime expectations: port numbers, required env vars, config files, the process manager (none, `tini`, `dumb-init`), and how secrets are supplied.

## Core guidance

### Dockerfile structure

- Start with `# syntax=docker/dockerfile:1` to get current features (heredocs, `--mount`, `COPY --link`).
- Pin base images to a specific tag (`node:22-bookworm-slim`, `python:3.12-slim`), never `latest`. Pin by digest (`image@sha256:...`) for release builds if the repo already does so.
- Order instructions from least to most frequently changing: base image, system packages, dependency manifests, dependency install, application source, build. This maximizes cache hits.
- Copy dependency manifests first, install, then copy the rest:

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app --create-home app
COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --chown=app:app package.json ./
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
```

- Use multi-stage builds: build tools and dev dependencies stay in builder stages; the final stage contains only the runtime and artifacts.
- Run as a non-root user in the final stage (`USER app`). Create the user with `useradd`/`adduser`; set file ownership with `COPY --chown`.
- Use exec-form `CMD ["bin", "arg"]` so signals reach the process; avoid shell form unless you need shell expansion. If the process does not handle `SIGTERM`, add `tini` (`ENTRYPOINT ["tini", "--"]`) or `--init` at run time.
- Combine package-manager steps into one `RUN` and clean caches in the same layer:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
```

- Use `RUN --mount=type=cache,target=<cache dir>` for package manager caches (npm, pip, go build, cargo) instead of copying caches into layers.
- Use `RUN --mount=type=secret,id=npmrc,target=/root/.npmrc` for build-time secrets; never `ARG` or `ENV` a secret (it stays in image history).
- `ARG` for build-time values, `ENV` for runtime values. Put `ARG` after `FROM` when a stage needs it; `ARG`s before the first `FROM` are only visible to `FROM` lines.
- `WORKDIR` instead of `cd`; absolute paths in `COPY`.
- Add `HEALTHCHECK` for long-running services; orchestrators and compose `depends_on: condition: service_healthy` rely on it.

### Image size

- Slim or distroless final images (`-slim`, `gcr.io/distroless/*`, `alpine` only if the app and its native deps work on musl).
- `.dockerignore` must exclude `.git`, `node_modules`, build outputs, test fixtures, local env files and editor state.
- Check what each layer adds: `docker history --no-trunc <image>` or `docker image inspect`. Use `dive` if available.
- Static binaries (Go, Rust) can use `FROM scratch` or distroless `static` with CA certs copied in.

### Compose for local development

```yaml
services:
  api:
    build:
      context: .
      target: dev            # a stage with dev tooling, if one exists
    ports: ["3000:3000"]
    env_file: .env
    volumes:
      - .:/app
      - /app/node_modules    # keep container deps, do not shadow with host dir
    depends_on:
      db:
        condition: service_healthy
    develop:
      watch:                 # docker compose watch
        - action: sync
          path: ./src
          target: /app/src
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: dev
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      retries: 10
    volumes:
      - dbdata:/var/lib/postgresql/data
volumes:
  dbdata:
```

- Named volumes for databases; bind mounts for source code.
- Use `profiles:` for optional services (e.g. `profiles: ["tools"]`) and `docker compose --profile tools up`.
- Keep secrets in `.env` (gitignored) or compose `secrets:`; never commit real credentials in `compose.yaml`.
- Service names are DNS names on the compose network; connect with `db:5432`, not `localhost`.

### Security

- Non-root `USER`, read-only root filesystem where possible (`docker run --read-only --tmpfs /tmp`), drop capabilities (`--cap-drop ALL`), no `--privileged`.
- Scan images: `docker scout cves <image>` (Docker Desktop/Scout) or `trivy image <image>`. Fix by bumping the base image tag and dependencies.
- Rebuild regularly to pick up base-image patches; `docker build --pull` in CI.
- Do not bake `.env`, SSH keys, cloud credentials or `.git` into images; verify with `docker history` and `docker run --rm -it <image> sh -c 'ls -la /app'`.

## Common tasks

### Containerize an existing app

1. Identify runtime (language version, build command, start command, port, env vars) from `package.json`/`pyproject.toml`/`go.mod`/`Makefile`.
2. Write `.dockerignore` first.
3. Write a multi-stage `Dockerfile` following the pattern above; pick the slim official image for the exact language version.
4. Build: `docker build -t app:dev .` then run: `docker run --rm -p 3000:3000 --env-file .env app:dev`.
5. Verify the app responds, the process is PID 1 or under `tini`, and `docker exec <ctr> id` shows a non-root user.
6. Add a `compose.yaml` if the app needs a database, cache or queue locally.

### Create a `.dockerignore`

```
.git
.gitignore
node_modules
dist
build
coverage
*.log
.env
.env.*
!.env.example
.vscode
.idea
Dockerfile*
compose*.y*ml
```

Adjust for the language (`__pycache__`, `.venv`, `target/`, `bin/`, `obj/`).

### Speed up a slow build

1. `docker build --progress=plain .` to see which steps miss the cache.
2. Move frequently changing `COPY` lines later; copy manifests before source.
3. Add `--mount=type=cache` for package managers.
4. In CI, use `docker buildx build --cache-from type=gha --cache-to type=gha,mode=max` (GitHub) or a registry cache (`type=registry,ref=...`).

### Debug a container

```bash
docker ps -a                                   # status, exit codes
docker logs -f --tail 200 <ctr>                # stdout/stderr
docker inspect <ctr> --format '{{json .State}}' | jq
docker exec -it <ctr> sh                       # or bash; distroless has no shell
docker run --rm -it --entrypoint sh <image>    # inspect image contents without the app
docker stats                                   # CPU/memory live
docker compose logs -f <service>
docker compose exec <service> sh
```

- Exit code 137 = OOM-killed or `SIGKILL`; 139 = segfault; 126/127 = command not found or not executable (check `CMD` path and exec form).
- For distroless images, debug with an ephemeral tool image sharing the namespace: `docker run --rm -it --pid container:<ctr> --network container:<ctr> busybox sh`.
- `docker compose config` prints the fully resolved compose file (interpolated env, merged overrides).

### Multi-platform build and push

```bash
docker buildx create --use --name multi   # once
docker buildx build --platform linux/amd64,linux/arm64 -t registry/app:1.2.3 --push .
```

### Run a one-off command against compose services

```bash
docker compose run --rm api npm run migrate
docker compose exec db psql -U postgres
```

## Pitfalls

- `COPY . .` before `npm ci`/`pip install` invalidates the dependency cache on every source change.
- Missing `.dockerignore` sends `.git` and `node_modules` to the daemon, slowing builds and leaking files into the image.
- `latest` tags and unpinned `apt-get install` produce non-reproducible builds.
- Secrets in `ARG`/`ENV`/`COPY .env` persist in image layers even if deleted later.
- Shell-form `CMD npm start` makes `sh` PID 1; `SIGTERM` never reaches node and the container takes 10s to stop. Use exec form or `tini`.
- Binding `localhost`/`127.0.0.1` inside the container makes the port unreachable from outside; listen on `0.0.0.0`.
- `volumes: - .:/app` shadows `node_modules` built in the image; add an anonymous volume for it or install deps on the host.
- Alpine + native modules (`sharp`, `bcrypt`, `psycopg2`) fail or need build tools; use `-slim` Debian images unless musl compatibility is verified.
- `depends_on` without `condition: service_healthy` only orders startup, it does not wait for readiness.
- Running `chown -R` on a large tree in a separate `RUN` doubles the layer size; use `COPY --chown` instead.
- Building on an arm64 Mac and deploying to amd64 without `--platform` produces images that fail with `exec format error`.

## Verification

```bash
docker build -t app:check .                                  # builds cleanly
docker run --rm app:check <version/health command>          # starts
docker run --rm app:check id                                 # non-root uid
docker image ls app:check                                    # size sane
docker scout cves app:check   # or: trivy image app:check    # no critical CVEs
docker compose config -q                                     # compose file valid
docker compose up -d && docker compose ps                    # all services healthy
hadolint Dockerfile                                          # lint, if installed
```

## References

- Dockerfile reference: https://docs.docker.com/reference/dockerfile/
- Build best practices: https://docs.docker.com/build/building/best-practices/
- BuildKit cache and secret mounts: https://docs.docker.com/build/cache/optimize/
- Compose file reference: https://docs.docker.com/reference/compose-file/
- Compose watch: https://docs.docker.com/compose/how-tos/file-watch/
- hadolint: https://github.com/hadolint/hadolint
- Trivy: https://aquasecurity.github.io/trivy/
