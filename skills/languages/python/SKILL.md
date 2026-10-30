---
name: python
description: Write, refactor and review Python (3.11+) in applications, libraries, scripts and services. Covers typing and type checkers (mypy, pyright), packaging and environments (pyproject.toml, uv, poetry, pip, venv), ruff/black formatting, pytest, asyncio, dataclasses and pydantic at boundaries, and project layout. Use when editing .py files or a project with pyproject.toml, requirements.txt, Pipfile or setup.py.
---

# Python

Assumes Python 3.11+ (3.12 preferred). Where a feature needs a newer version, it is noted.

## When to use

- Editing or creating `.py`, `.pyi` files, or notebooks that import project code.
- Changing `pyproject.toml`, `requirements*.txt`, `setup.py`/`setup.cfg`, `Pipfile`, `tox.ini`, `noxfile.py`.
- Reviewing Python for typing, async correctness, packaging or test quality.

## Project conventions to detect first

Before writing code, check:

1. **Interpreter version**: `requires-python` in `pyproject.toml`, `.python-version`, `runtime.txt`, CI matrix, `Dockerfile`. Do not use syntax newer than the minimum supported version (e.g. `type X = ...` aliases need 3.12, `match` needs 3.10).
2. **Package manager and lockfile**: `uv.lock` (uv), `poetry.lock` + `[tool.poetry]` (poetry), `Pipfile.lock` (pipenv), `pdm.lock` (pdm), `requirements*.txt` (pip, often with pip-tools `requirements.in`). Use the one already present; never add a second lockfile.
3. **Layout**: `src/<package>/` (src layout, preferred) vs flat `<package>/` at the root; where tests live (`tests/` top level vs inside the package); whether `conftest.py` exists.
4. **Tooling config** in `pyproject.toml` (`[tool.ruff]`, `[tool.black]`, `[tool.mypy]`, `[tool.pyright]`, `[tool.pytest.ini_options]`) or standalone files (`ruff.toml`, `mypy.ini`, `pyrightconfig.json`, `setup.cfg`, `pytest.ini`, `.pre-commit-config.yaml`). Match the configured line length and rule set.
5. **Existing style**: absolute vs relative imports, `dataclasses` vs `pydantic` vs `attrs`, logging setup, how config/env is read, how errors are modelled, sync vs async codebase.

## Core guidance

### Typing

- Annotate all public function signatures and module-level constants. Internal helpers too when it is cheap.
- Use builtin generics and PEP 604 unions: `list[str]`, `dict[str, int]`, `int | None`. Do not import `List`, `Dict`, `Optional` from `typing` in 3.11+ code.
- Accept abstract types, return concrete ones: parameters `Iterable[str]`, `Mapping[str, int]`, `Sequence[T]` (from `collections.abc`); return `list[str]`.
- `TypedDict` for dict-shaped data you do not control, `Protocol` for structural interfaces, `Literal[...]` for fixed string sets, `Self` (3.11) for fluent APIs, `TypeAlias` or `type X = ...` (3.12) for complex aliases.
- Narrow `object`/`Any` at boundaries with `isinstance`, `TypeGuard`/`TypeIs` (3.13), or a validation library. Avoid `cast()` unless commented.
- Model states with tagged unions and `match`:

```python
from dataclasses import dataclass

@dataclass(frozen=True, slots=True)
class Ok[T]:          # 3.12 syntax; use Generic[T] on 3.11
    value: T

@dataclass(frozen=True, slots=True)
class Err:
    message: str

def handle(result: Ok[int] | Err) -> int:
    match result:
        case Ok(value=v):
            return v
        case Err(message=m):
            raise RuntimeError(m)
```

- Run the type checker the project uses (`mypy` or `pyright`); do not add `# type: ignore` without an error code and a reason: `# type: ignore[arg-type]  # third-party stub is wrong`.

### Data at boundaries

- `@dataclass(frozen=True, slots=True)` for internal value objects; `kw_only=True` when there are more than ~3 fields.
- Pydantic v2 (`BaseModel`, `model_validate`, `model_dump`, `Field`) for parsing untrusted input: HTTP bodies, config files, env vars (`pydantic-settings`). Check the installed major version (`pip show pydantic`); v1 and v2 APIs differ (`.dict()` vs `.model_dump()`, `@validator` vs `@field_validator`).
- Validate once at the edge, then pass typed objects inward. Do not pass raw dicts through business logic.
- Use `enum.StrEnum` (3.11) for string enums serialized to JSON.

### Errors

- Raise specific exceptions; define a small hierarchy rooted at one project base class (`class AppError(Exception)`).
- Catch narrowly; never bare `except:` and avoid `except Exception` except at process boundaries (request handler, CLI main) where you log and convert.
- Chain explicitly: `raise ParseError(...) from exc`. Use `exc.add_note(...)` (3.11) to attach context.
- Use `ExceptionGroup` / `except*` (3.11) when handling errors from `asyncio.TaskGroup`.
- Prefer returning `None`/a result type for *expected* absence; exceptions for *unexpected* failures.

### Async

- `asyncio.run(main())` once at the entry point. Never call `asyncio.run` inside a running loop.
- Use `asyncio.TaskGroup` (3.11) instead of bare `create_task` + `gather` for structured concurrency; `asyncio.timeout()` (3.11) for deadlines.
- Never block the loop: wrap CPU work or sync I/O in `await asyncio.to_thread(fn, ...)`.
- Use async-native clients (`httpx.AsyncClient`, `asyncpg`, `aiofiles`) in async code; do not call `requests` from a coroutine.
- Keep sync and async APIs separate; do not offer both from one function via flags.

### Modules, imports, structure

- Absolute imports from the package root (`from myapp.core import x`). Relative imports only within a tightly coupled subpackage if the repo already does so.
- No side effects at import time (no network, no file writes, no heavy computation). Guard scripts with `if __name__ == "__main__":`.
- Keep `__init__.py` small: re-export the public surface, define `__all__`.
- Use `pathlib.Path`, not `os.path`. Use `logging.getLogger(__name__)`, not `print`, in library code.
- Context managers (`with`) for every resource; `contextlib.contextmanager`/`asynccontextmanager` for custom ones.
- Prefer comprehensions and generator expressions over `map`/`filter` with lambdas; prefer `itertools`/`functools` over hand-rolled loops when clearer.

### Packaging

- Single source of truth: `pyproject.toml` with `[project]` (PEP 621): `name`, `version`, `requires-python`, `dependencies`, `[project.optional-dependencies]` or `[dependency-groups]` (PEP 735, used by uv) for dev tools, `[project.scripts]` for CLIs.
- Build backend: `hatchling` or `setuptools>=61` for plain packages; `poetry-core` if the project is poetry-managed. Check `[build-system]` before changing.
- Pin in lockfiles, not in `dependencies` (use `>=` lower bounds; upper bounds only with a reason).
- Add a dependency with the project's tool, which updates the lockfile:

```bash
uv add httpx            # uv
uv add --dev pytest     # dev group
poetry add httpx        # poetry
poetry add --group dev pytest
pip install httpx && pip freeze > requirements.txt   # plain pip (or edit requirements.in + pip-compile)
```

## Common tasks

### Set up or enter the environment

```bash
uv sync                      # uv: creates .venv and installs lock
poetry install               # poetry
python -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]"   # pip
```

Run tools through the manager so the right environment is used: `uv run pytest`, `poetry run pytest`, or activate the venv first.

### Add a new module

1. Create `src/<package>/<area>/<name>.py` (or wherever existing modules live); add to `__init__.py` only if it is public API.
2. Fully annotate the public functions; keep helpers private with a leading underscore.
3. Add `tests/<area>/test_<name>.py` using the fixtures in `conftest.py`.
4. Run `ruff check`, `ruff format` (or `black`), the type checker, and `pytest`.

### Write tests (pytest)

- Plain functions named `test_*`; use `assert` with expressions, not `self.assertEqual`.
- Fixtures over setup methods; `tmp_path`, `monkeypatch`, `capsys`, `caplog` are built in.
- `@pytest.mark.parametrize` for table tests; `pytest.raises(ExcType, match=r"...")` for errors.
- Async tests: `pytest-asyncio` (`@pytest.mark.asyncio` or `asyncio_mode = "auto"` in config) or `anyio`. Check which plugin is installed before writing.
- Mock at the boundary with `unittest.mock.patch("module.under.test.dependency")`, patching where the name is *looked up*, not where it is defined. Prefer fakes/fixtures over deep mocking.
- Run a subset fast: `pytest tests/test_x.py::test_name -x -q`; `pytest -k "pattern"`; `pytest --lf` for last failures.

### Add a CLI

- Small: `argparse` in `__main__.py`. Larger: `typer` or `click` if already a dependency.
- Register under `[project.scripts] myapp = "myapp.cli:main"`; `main()` returns an `int` exit code and does not call `sys.exit` itself.

### Make a function async-safe or add concurrency

```python
async def fetch_all(urls: list[str]) -> list[bytes]:
    async with httpx.AsyncClient(timeout=10) as client, asyncio.TaskGroup() as tg:
        tasks = [tg.create_task(client.get(u)) for u in urls]
    return [t.result().content for t in tasks]
```

### Migrate `setup.py`/`requirements.txt` to `pyproject.toml`

1. Move metadata into `[project]`; keep `setup.py` only if it has custom build logic.
2. Move `requirements.txt` entries into `dependencies` (loosen exact pins to lower bounds) and dev tools into a dev group.
3. Generate the lockfile with the chosen tool (`uv lock` / `poetry lock`) and commit it.
4. Update CI and `Dockerfile` install commands.

## Pitfalls

- Mutable default arguments (`def f(items=[])`); use `None` and create inside, or `field(default_factory=list)` in dataclasses.
- Late-binding closures in loops (`lambda: i`); bind with a default argument or `functools.partial`.
- `from module import *` and circular imports; move shared types into a leaf module or import inside the function.
- Comparing with `== None`/`== True`; use `is None`, truthiness, or explicit `is True` only when distinguishing from `1`.
- Catching `Exception` to swallow errors silently; at minimum `logger.exception(...)` and re-raise or convert.
- String formatting in log calls (`logger.info(f"...")`); use `logger.info("user=%s", user)` so formatting is lazy and structured.
- `datetime.utcnow()` (deprecated, naive); use `datetime.now(timezone.utc)` and keep datetimes aware.
- `os.environ["X"]` scattered through code; read config once (pydantic-settings or a `Config` dataclass) and pass it in.
- `time.sleep`, `requests`, or `open()` inside `async def`: blocks the event loop.
- Forgetting `await` returns a coroutine object silently; enable ruff rule `RUF006`/`ASYNC` set and type-check.
- Shadowing stdlib module names with files (`json.py`, `types.py`, `test.py`) breaks imports.
- Relying on dict ordering of `**kwargs` in signatures or on `set` iteration order in tests.
- Changing `requires-python` or dependency bounds without updating the lockfile.

## Verification

Discover commands in `pyproject.toml` (`[tool.*]` sections, `[project.scripts]`), `Makefile`, `noxfile.py`/`tox.ini`, `.pre-commit-config.yaml`, or CI config. Typical loop (prefix with `uv run` / `poetry run` as appropriate):

```bash
ruff check . --fix          # lint (replaces flake8/isort/pyupgrade); use `ruff check --select I --fix` for imports only
ruff format .               # or: black .
mypy .                      # or: pyright
pytest -q                   # tests; add --cov if pytest-cov is configured
python -m build             # if the project is a distributable package
```

If `pre-commit` is configured: `pre-commit run --all-files`. Fix every type and lint error; do not add blanket ignores to make the run green.

## References

- Python docs (3.12): https://docs.python.org/3/
- typing module and cheat sheets: https://typing.readthedocs.io/en/latest/
- Packaging guide (pyproject.toml): https://packaging.python.org/en/latest/guides/writing-pyproject-toml/
- uv: https://docs.astral.sh/uv/
- ruff rules: https://docs.astral.sh/ruff/rules/
- mypy: https://mypy.readthedocs.io/ , pyright: https://microsoft.github.io/pyright/
- pytest: https://docs.pytest.org/en/stable/
- asyncio: https://docs.python.org/3/library/asyncio.html
- pydantic v2: https://docs.pydantic.dev/latest/
