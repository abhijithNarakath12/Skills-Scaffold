---
name: sqlalchemy
description: Write database code with SQLAlchemy 2.x - declarative models using Mapped/mapped_column, Session and unit-of-work, the select() API, relationships and loading strategies (selectinload/joinedload), async engines, Alembic migrations, and testing. Load when a Python project depends on sqlalchemy, alembic or sqlmodel, has an alembic.ini/alembic/ folder, or when writing ORM models, queries or migrations.
---

# SQLAlchemy 2.x

Assumes SQLAlchemy 2.0+ with the 2.0-style API (`select()`, `Session.execute`, `Mapped[]` annotations) and Python 3.10+. Legacy `session.query()` and `declarative_base()` appear in older code; do not add new usages. SQLModel wraps SQLAlchemy models with Pydantic; the query and session guidance here applies to it too.

## When to use

- Defining or changing ORM models, relationships, indexes, constraints.
- Writing queries, bulk operations, transactions, or fixing N+1/lazy-loading problems.
- Creating Alembic migrations, autogenerate review, or data migrations.
- Async database access (asyncpg, aiosqlite, aiomysql) in FastAPI/Litestar/aiohttp.
- Setting up database fixtures for pytest.

## Project conventions to detect first

1. Version: `sqlalchemy` in `pyproject.toml`/`requirements*.txt`; 2.x required for the idioms below. `sqlmodel` means FastAPI-style models (`class Hero(SQLModel, table=True)`).
2. Base class location: `class Base(DeclarativeBase)` (2.0) vs `Base = declarative_base()` (legacy) in `models/base.py` or `db.py`. Reuse it.
3. Session factory: `sessionmaker(engine, expire_on_commit=False)` / `async_sessionmaker`; how sessions are provided (FastAPI dependency `get_db`, Flask-SQLAlchemy `db.session`, context manager). Follow the existing scoping (one session per request/unit of work).
4. Driver and URL: `postgresql+psycopg://` (psycopg 3), `postgresql+asyncpg://`, `sqlite+aiosqlite://`, `mysql+pymysql://`. Settings usually via `pydantic-settings` or env vars.
5. Alembic: `alembic.ini`, `alembic/env.py` (check `target_metadata = Base.metadata`, whether it is async, and `compare_type`/`render_as_batch` flags), `alembic/versions/`.
6. Naming convention on `MetaData` (`naming_convention={...}`) so constraints get deterministic names; required for `render_as_batch` on SQLite.
7. Type checking: mypy/pyright with the `Mapped[]` typing; no plugin needed in 2.x.
8. Test setup: `conftest.py` fixtures for engine/session, transactional rollback pattern, or `testcontainers`.

## Core guidance

### Models

```python
from datetime import datetime
from sqlalchemy import ForeignKey, String, func, Index
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str | None]                       # nullable inferred from Optional
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    posts: Mapped[list["Post"]] = relationship(back_populates="author", cascade="all, delete-orphan")

class Post(Base):
    __tablename__ = "posts"
    __table_args__ = (Index("ix_posts_author_published", "author_id", "published"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str]
    published: Mapped[bool] = mapped_column(default=False)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    author: Mapped["User"] = relationship(back_populates="posts")
```

- `Mapped[T]` drives nullability and the Python type; `mapped_column()` only for DB specifics (length, defaults, FK, index). Map custom types via `type_annotation_map` on `Base`.
- Always `back_populates` both sides (not `backref`). `cascade="all, delete-orphan"` on the parent collection for owned children; set `ondelete="CASCADE"` on the FK too so the DB enforces it.
- Many-to-many: a `Table` object plus `secondary=`; use an association class when the join table has extra columns.
- Enums: `Mapped[Role]` with `sqlalchemy.Enum(Role, native_enum=False)` or a native PostgreSQL enum; decide once and document, because changing native enums needs manual migrations.
- `default=` is Python-side, `server_default=` is in DDL; use `server_default=func.now()` for timestamps so raw SQL inserts get them too.

### Session and unit of work

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(engine, expire_on_commit=False)

def create_user(email: str) -> User:
    with SessionLocal.begin() as session:      # commits on success, rolls back on exception
        user = User(email=email)
        session.add(user)
        session.flush()                        # assigns user.id without committing
        return user
```

- One `Session` per request or logical unit of work; never a module-level global session shared across threads. The engine is global and owns the connection pool.
- `session.add()` + `commit()` for new objects; modifying an attribute on a loaded object is tracked automatically (dirty checking). No explicit "update" call.
- `expire_on_commit=False` avoids lazy reloads after commit (mandatory for async, convenient for web apps). With the default, attribute access after commit issues a new SELECT.
- `session.get(User, id)` for primary-key lookups (uses the identity map). `session.refresh(obj)` to reload.
- Bulk: `session.execute(insert(User), [{"email": ...}, ...])` (ORM bulk insert), `session.execute(update(User).where(...).values(...))` for set-based updates; they bypass per-object events and relationship cascades.
- Nested transactions: `with session.begin_nested():` emits a SAVEPOINT.

### Queries (select API)

```python
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload, joinedload

stmt = (
    select(Post)
    .join(Post.author)
    .where(User.email == email, Post.published.is_(True))
    .options(selectinload(Post.author))
    .order_by(Post.id.desc())
    .limit(20)
)
posts = session.scalars(stmt).all()                           # list[Post]
post = session.scalars(select(Post).where(Post.id == 1)).one_or_none()
rows = session.execute(select(User.id, func.count(Post.id)).join(User.posts).group_by(User.id)).all()  # Row tuples
total = session.scalar(select(func.count()).select_from(Post))
```

- `session.scalars(stmt)` for single-entity selects; `session.execute(stmt)` for multi-column rows; `.one()`, `.one_or_none()`, `.first()`, `.all()`, `.partitions()` for large results (`stmt.execution_options(yield_per=500)`).
- Comparison helpers: `.is_(None)`, `.in_(ids)`, `.ilike("%q%")`, `or_()`, `and_()`, `~Post.published`. Pass Python values; never format SQL strings.
- `select(Post).join(Post.author)` joins along the relationship (correct ON clause). `.outerjoin()` for LEFT JOIN.
- Pagination: keyset (`where(Post.id < last_id)`) for feeds; `offset()` only for small admin tables.
- `text("...")` with `:param` bind parameters when raw SQL is needed; `.columns()` to map to types.

### Relationship loading

- Default is lazy loading (one query per attribute access per object): N+1. Choose a strategy per query with `.options(...)`:
  - `selectinload(Post.author)`: second query with `IN (...)`; best for collections and most to-one cases.
  - `joinedload(Post.author)`: LEFT JOIN in the same query; good for to-one. For collections call `.unique()` on the result (`session.scalars(stmt).unique().all()`).
  - `raiseload("*")` in tests/dev to fail fast on unintended lazy loads.
- Set a default on the relationship when the strategy is always the same: `relationship(lazy="selectin")`; `lazy="raise"` for models that must be loaded explicitly.
- Chain for nesting: `selectinload(User.posts).selectinload(Post.tags)`.
- `contains_eager()` when you already joined explicitly and want to populate the relationship from that join.

### Async

```python
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

engine = create_async_engine("postgresql+asyncpg://...", pool_size=10)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

async def get_db():                                   # FastAPI dependency
    async with AsyncSessionLocal() as session:
        yield session

async def list_posts(session: AsyncSession) -> list[Post]:
    result = await session.scalars(select(Post).options(selectinload(Post.author)))
    return list(result)
```

- Lazy loading cannot run in async (`MissingGreenlet` error): every relationship accessed must be eager-loaded via `options()` or `lazy="selectin"`, or loaded with `await session.run_sync(lambda s: obj.posts)` / `AsyncAttrs` (`await obj.awaitable_attrs.posts`).
- Call `await session.commit()`, `await session.refresh(obj)`, `await engine.dispose()` at shutdown.
- Alembic with async: use the `async` template (`alembic init -t async alembic`) so `env.py` runs migrations through `connection.run_sync`.
- SQLite in async tests: `sqlite+aiosqlite:///:memory:` needs `poolclass=StaticPool` to share one connection.

### Alembic migrations

```bash
alembic init alembic                     # once; set sqlalchemy.url in alembic.ini or env.py, target_metadata = Base.metadata
alembic revision --autogenerate -m "add posts"
alembic upgrade head
alembic downgrade -1
alembic history --verbose ; alembic current
```

- Autogenerate detects tables, columns, indexes, FKs, and (with `compare_type=True`, default in Alembic 1.12+) type changes. It does not detect renames (emits drop+add), server defaults by default, or enum value changes; edit the generated file.
- Every model module must be imported before `target_metadata` is read, or autogenerate drops the "missing" tables.
- Data migrations: use `op.get_bind()` and Core `table()`/`column()` constructs, never ORM models (they change later).
- SQLite: `render_as_batch=True` in `context.configure` so `ALTER` becomes batch "move and copy".
- Keep one head; on merge conflicts run `alembic merge heads -m "merge"`. CI should run `alembic upgrade head` on an empty DB and `alembic check` (1.9+) to confirm models and migrations agree.

### Testing

```python
# conftest.py: transaction-per-test, rolled back
@pytest.fixture(scope="session")
def engine():
    engine = create_engine(TEST_DATABASE_URL)
    Base.metadata.create_all(engine)       # or run alembic upgrade head
    yield engine
    Base.metadata.drop_all(engine)

@pytest.fixture
def session(engine):
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    yield session
    session.close()
    transaction.rollback()
    connection.close()
```

- Prefer the production database engine in tests (Docker/`testcontainers-python`); SQLite differs in types, constraints, and `RETURNING`.
- `join_transaction_mode="create_savepoint"` (2.0) lets code under test call `session.commit()` while the outer transaction still rolls back.
- Factories: `factory_boy` with `SQLAlchemyModelFactory` or simple helper functions; avoid shared fixtures that leak state.

## Common tasks

### Add a model

1. Create the class in the models package; import it in the package `__init__` (so Alembic sees it).
2. `alembic revision --autogenerate -m "add <table>"`; review and adjust the script (indexes, defaults, ondelete).
3. `alembic upgrade head`; add a repository/service function and a test.

### Rename a column

Edit the autogenerated migration to `op.alter_column("posts", "title", new_column_name="headline")` instead of drop + add.

### Fix an N+1

1. Enable `echo=True` or `raiseload("*")` in the failing test to find the lazy load.
2. Add `selectinload`/`joinedload` on the originating `select()`, or set `lazy="selectin"` on the relationship.

### Upsert

PostgreSQL: `from sqlalchemy.dialects.postgresql import insert`; `stmt = insert(User).values(...).on_conflict_do_update(index_elements=[User.email], set_={"name": stmt.excluded.name})`. SQLite has the same API under `sqlalchemy.dialects.sqlite`; MySQL uses `on_duplicate_key_update`.

## Pitfalls

- Mixing 1.x `session.query(User).filter()` with 2.x code; migrate to `select()` and `session.scalars()`.
- Accessing lazy relationships after the session closed (`DetachedInstanceError`) or in async code (`MissingGreenlet`); eager load or keep the session open.
- `joinedload` on collections without `.unique()` raises in 2.0.
- Forgetting `expire_on_commit=False` and then reading attributes after `commit()` in async code.
- Sharing one `Session` across threads or requests; sessions are not thread-safe.
- `relationship()` defined on one side only, then wondering why `user.posts` does not update after `post.author = user` within the same session.
- Python-side `default=datetime.utcnow` evaluated once if written as `default=datetime.utcnow()` (call, not callable).
- Autogenerate run without importing all models; migration drops tables.
- Alembic `env.py` reading a different URL than the app (hardcoded `alembic.ini`); load from the same settings module.
- Committing inside loops; batch work in one transaction.
- Enum columns on PostgreSQL with `native_enum=True`: adding a value needs `ALTER TYPE ... ADD VALUE` in a migration outside a transaction block (`op.execute` with `autocommit_block()`).

## Verification

```bash
alembic upgrade head && alembic check          # migrations apply; models match (Alembic >= 1.9)
alembic revision --autogenerate -m tmp --sql   # dry-run SQL on older Alembic; discard the file
pytest -x -q
mypy . | pyright                               # Mapped[] typing errors surface here
ruff check .
```

Check `pyproject.toml`, `Makefile`, or `tox.ini` for the project's own targets (`make migrate`, `make test`).

## References

- SQLAlchemy 2.0 ORM quickstart: https://docs.sqlalchemy.org/en/20/orm/quickstart.html
- What's new in 2.0 / migration: https://docs.sqlalchemy.org/en/20/changelog/migration_20.html
- Relationship loading techniques: https://docs.sqlalchemy.org/en/20/orm/queryguide/relationships.html
- Asyncio extension: https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html
- Alembic tutorial and autogenerate: https://alembic.sqlalchemy.org/en/latest/autogenerate.html
- SQLModel: https://sqlmodel.tiangolo.com/
