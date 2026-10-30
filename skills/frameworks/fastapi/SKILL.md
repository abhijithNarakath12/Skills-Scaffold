---
name: fastapi
description: Build and maintain FastAPI services with Pydantic v2, SQLAlchemy 2.0 or SQLModel, covering APIRouter structure, dependency injection (Depends), async vs sync endpoints, pydantic-settings, OAuth2/JWT auth, background tasks, exception handling, Alembic migrations, uvicorn and testing with TestClient/httpx. Use when a Python project depends on fastapi or when editing files that import from fastapi, pydantic or sqlalchemy in an API service.
---

# FastAPI

Assumes FastAPI 0.100+ with Pydantic v2 (`model_validator`, `model_config`, `model_dump`), Python 3.10+ typing (`X | None`, `Annotated`), SQLAlchemy 2.0 style (`Mapped`, `mapped_column`, `select()`), and uvicorn. Check `pydantic` and `sqlalchemy` versions before writing models; v1-style `class Config` / `.dict()` / `Query` ORM calls are legacy.

## When to use

- Adding routers, endpoints, request/response models, dependencies, middleware or exception handlers.
- Database access with SQLAlchemy/SQLModel, Alembic migrations.
- Auth (OAuth2 password flow, JWT, API keys), settings, background tasks, lifespan startup/shutdown.
- Writing tests with `TestClient` or `httpx.AsyncClient`.
- Not for Django/Flask apps, or Starlette-only apps without FastAPI.

## Project conventions to detect first

1. Package manager and runner: `pyproject.toml` with `uv` (`uv.lock`), `poetry` (`poetry.lock`), `pdm`, or `requirements.txt`+`pip`. Use `uv run`/`poetry run` accordingly.
2. Versions: `fastapi`, `pydantic` (v2 if `pydantic>=2`), `sqlalchemy` (2.x), `sqlmodel`, `alembic`, `pydantic-settings`. `fastapi[standard]` includes uvicorn, `fastapi` CLI and `python-multipart`.
3. Layout: `app/main.py` (creates `FastAPI()`), `app/api/routers/*.py` or `app/<feature>/router.py`, `app/models.py` (ORM), `app/schemas.py` (Pydantic), `app/crud.py`/`services/`, `app/core/config.py`, `app/db.py`/`database.py`, `alembic/` with `alembic.ini`, `tests/`.
4. Sync or async DB: `create_engine` + `Session` (sync, use `def` endpoints) vs `create_async_engine` + `AsyncSession` (`asyncpg`/`aiosqlite`, use `async def`). Do not mix within one request path.
5. Dependency style: `Annotated[Session, Depends(get_db)]` aliases (`SessionDep`, `CurrentUser`) vs inline `db: Session = Depends(get_db)`. Follow the existing style.
6. Settings: `pydantic_settings.BaseSettings` with `.env`; whether `Settings()` is a module global or an `lru_cache` dependency.
7. Auth: `OAuth2PasswordBearer`, `python-jose`/`PyJWT`, `passlib`/`bcrypt`/`argon2-cffi`; or `fastapi-users`, `authlib`.
8. Tooling: `ruff` (lint + format), `mypy`/`pyright`, `pytest` with `pytest-asyncio` or `anyio` plugin, `httpx`, `pytest-cov`. Check `[tool.*]` sections in `pyproject.toml`.
9. Deployment: `Dockerfile` CMD (`uvicorn app.main:app`, `fastapi run`, `gunicorn -k uvicorn.workers.UvicornWorker`).

## Core guidance

### Application and routers

```python
# app/main.py
from contextlib import asynccontextmanager
from fastapi import FastAPI
from app.api.routers import users, items
from app.core.config import settings

@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup: warm caches, check DB connectivity
    yield
    # shutdown: close clients/pools

app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.include_router(users.router, prefix="/api/v1/users", tags=["users"])
app.include_router(items.router, prefix="/api/v1/items", tags=["items"])
```

- Use `lifespan`, not the deprecated `@app.on_event("startup")`.
- One `APIRouter` per resource; put `prefix`, `tags`, shared `dependencies=[Depends(require_user)]` on the router or at `include_router`.
- Endpoint signature declares everything: path params, `Query()`, `Body()`, `Header()`, `Cookie()`, `Form()`, `File()`, and dependencies. FastAPI validates and documents from the signature.
- Set `response_model` (or return type annotation) on every endpoint so output is validated and filtered (e.g. never leak `hashed_password`). `status_code=status.HTTP_201_CREATED` for creates; `response_class=Response` + 204 for deletes.
- Pydantic v2 schemas: `class UserOut(BaseModel): model_config = ConfigDict(from_attributes=True)` to build from ORM objects; `UserCreate` / `UserUpdate` (all-optional) / `UserOut` separation.

### Async vs sync

- `async def` endpoints run on the event loop: never call blocking I/O (sync DB drivers, `requests`, `time.sleep`) inside them.
- `def` endpoints run in a threadpool: safe for sync SQLAlchemy sessions and blocking libraries.
- Rule: async driver (`asyncpg`, `aiosqlite`, `httpx.AsyncClient`) -> `async def`; sync driver (`psycopg2`, `sqlite3`) -> `def`. Dependencies follow the same rule.
- CPU-heavy work goes to `run_in_threadpool` (`fastapi.concurrency`) or a task queue (Celery, arq, Dramatiq), not `BackgroundTasks`.

### Dependencies

```python
from typing import Annotated
from fastapi import Depends
from sqlalchemy.orm import Session

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

SessionDep = Annotated[Session, Depends(get_db)]

def get_current_user(token: Annotated[str, Depends(oauth2_scheme)], db: SessionDep) -> User: ...
CurrentUser = Annotated[User, Depends(get_current_user)]

@router.get("/me", response_model=UserOut)
def read_me(user: CurrentUser):
    return user
```

- `yield` dependencies handle setup/teardown; code after `yield` runs after the response is sent (unless an exception). Commit inside the endpoint/service, not in the dependency's teardown, unless the project does so deliberately.
- Dependencies are cached per request by default; `Depends(fn, use_cache=False)` to disable.
- Override in tests with `app.dependency_overrides[get_db] = override_get_db`; clear after.
- Class-based dependencies (`class Pagination: def __init__(self, page: int = 1, size: int = Query(20, le=100))`) for reusable query param groups.

### Database (SQLAlchemy 2.0 / SQLModel)

```python
class Base(DeclarativeBase): ...

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    items: Mapped[list["Item"]] = relationship(back_populates="owner", lazy="selectin")

stmt = select(User).where(User.email == email)
user = db.scalars(stmt).first()          # sync
user = (await session.scalars(stmt)).first()  # async
```

- Use `select()`/`db.execute()`/`db.scalars()`, not legacy `db.query()`.
- Avoid lazy loading inside async sessions (raises `MissingGreenlet`); use `selectinload`/`joinedload` or `lazy="selectin"` on relationships.
- `expire_on_commit=False` on async session factories so returned objects remain usable after commit.
- SQLModel: one class with `table=True` for the ORM model, separate `SQLModel` classes for `Create`/`Public` schemas; `Session(engine)` with `session.exec(select(...))`.
- Alembic: `alembic revision --autogenerate -m "add users"` then review the generated file (autogenerate misses renames, server defaults, some type changes); `alembic upgrade head`. Make sure `alembic/env.py` imports all models so `target_metadata` is complete.

### Settings

```python
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="APP_", extra="ignore")
    app_name: str = "api"
    database_url: str
    secret_key: str
    access_token_expire_minutes: int = 30

settings = Settings()  # or @lru_cache def get_settings() for test overrides
```

### Auth (OAuth2 password + JWT)

1. `oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/v1/auth/token")`.
2. `/token` endpoint takes `Annotated[OAuth2PasswordRequestForm, Depends()]` (needs `python-multipart`), verifies the password hash, returns `{"access_token": jwt, "token_type": "bearer"}`.
3. `get_current_user` decodes with `jwt.decode(token, settings.secret_key, algorithms=["HS256"])`, raises `HTTPException(401, headers={"WWW-Authenticate": "Bearer"})` on failure, loads the user.
4. Role checks as additional dependencies (`require_admin`). Put `dependencies=[Depends(get_current_user)]` on routers that are fully protected.
5. Hash with `pwdlib`/`argon2-cffi`/`bcrypt`; never store plaintext; never log tokens.

### Errors

- Raise `HTTPException(status_code, detail)` for expected client errors. For domain errors define exceptions and register `@app.exception_handler(NotFoundError)` returning `JSONResponse`.
- Validation errors are 422 by default; override `RequestValidationError` handler only to change the shape.
- Do not catch broad `Exception` in endpoints; let it 500 and be logged by the server/APM.
- Add CORS via `CORSMiddleware` with explicit `allow_origins`; `GZipMiddleware`, `TrustedHostMiddleware` as needed. Custom middleware: `@app.middleware("http")` or pure ASGI middleware for performance.

### Background tasks

- `BackgroundTasks` parameter: `background_tasks.add_task(send_email, user.email)` runs after the response in the same process; fine for short, best-effort work. Anything that must survive restarts or takes seconds goes to a queue.

## Common tasks

### Add an endpoint

1. Pydantic schemas in `schemas.py` (`XCreate`, `XOut`).
2. Service/CRUD function taking a `Session` and typed inputs.
3. Router function with `response_model`, `status_code`, dependencies; raise `HTTPException(404)` when missing.
4. `include_router` if the router is new.
5. Test with `TestClient` for 2xx, 404 and 422.
6. Check `/docs` renders the operation correctly.

### Add a model and migration

1. Add the ORM class; import it where `alembic/env.py` can see it.
2. `alembic revision --autogenerate -m "..."`; inspect and fix the migration.
3. `alembic upgrade head`; run tests.

### Write tests

```python
# tests/conftest.py
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.api.deps import get_db

@pytest.fixture
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:      # context manager runs lifespan
        yield c
    app.dependency_overrides.clear()

def test_create_user(client):
    r = client.post("/api/v1/users", json={"email": "a@b.co", "password": "secret123"})
    assert r.status_code == 201
    assert r.json()["email"] == "a@b.co"
```

Async endpoints with async DB: use `httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test")` under `pytest-asyncio`/`anyio`. Use a transaction-per-test or a fresh SQLite/`testcontainers` database.

### Run locally

```bash
fastapi dev app/main.py                       # fastapi[standard] CLI, reload
uvicorn app.main:app --reload --port 8000     # equivalent
uvicorn app.main:app --host 0.0.0.0 --workers 4   # production-ish; or gunicorn -k uvicorn.workers.UvicornWorker
```

## Pitfalls

- Blocking calls (sync SQLAlchemy, `requests`, `time.sleep`) inside `async def` endpoints: throughput collapses.
- Missing `response_model`, leaking ORM fields such as password hashes.
- Pydantic v1 idioms (`class Config`, `.dict()`, `@validator`, `orm_mode`) in a v2 project (deprecation warnings, subtle behaviour changes); use `model_config`, `.model_dump()`, `@field_validator`, `from_attributes`.
- Mutable default arguments or shared `Session` at module scope; always one session per request via a dependency.
- Lazy-loading relationships in async sessions after the session closed.
- `app.on_event` instead of `lifespan`.
- Alembic autogenerate producing an empty migration because models are not imported in `env.py`.
- Circular imports between `main.py`, routers and `models.py`; keep dependencies in `deps.py` and import `app` only in `main.py`/tests.
- Forgetting `python-multipart` for forms/`OAuth2PasswordRequestForm` and `File`.
- Trailing-slash mismatch between route and client, causing 307 redirects that drop auth headers in some clients.

## Verification

```bash
cat pyproject.toml | sed -n '/\[tool/,$p'   # discover ruff/mypy/pytest config
uv run ruff check . && uv run ruff format --check .   # or poetry run / python -m
uv run mypy app                              # or pyright
uv run pytest -q
uv run alembic upgrade head && uv run alembic check   # alembic check: model/migration drift (Alembic 1.9+)
uv run fastapi dev app/main.py               # then open http://127.0.0.1:8000/docs
```

## References

- [references/database-patterns.md](references/database-patterns.md): sync and async SQLAlchemy session setup, SQLModel, Alembic configuration and test database strategies.
- FastAPI docs: https://fastapi.tiangolo.com/
- Full-stack template (reference layout): https://github.com/fastapi/full-stack-fastapi-template
- Pydantic v2 migration: https://docs.pydantic.dev/latest/migration/
- SQLAlchemy 2.0 ORM quickstart: https://docs.sqlalchemy.org/en/20/orm/quickstart.html
- Alembic autogenerate: https://alembic.sqlalchemy.org/en/latest/autogenerate.html
