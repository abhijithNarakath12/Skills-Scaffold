---
name: pytest
description: Write, organize and run Python tests with pytest 8. Covers fixtures and scopes, conftest.py, parametrize, markers, monkeypatch and pytest-mock, tmp_path, async tests with pytest-asyncio, coverage with pytest-cov, and configuration in pyproject.toml or pytest.ini. Use when a project depends on pytest, has conftest.py or pytest.ini, or when asked to add or fix Python tests.
---

# pytest

Assumes pytest 8.x on Python 3.10+. Check with `pytest --version`; plugin versions with `pip list | grep pytest`.

## When to use

- Adding or fixing `test_*.py` / `*_test.py` files, fixtures, or `conftest.py`.
- Configuring pytest in `pyproject.toml`, `pytest.ini`, `setup.cfg` or `tox.ini`.
- Debugging failing, slow, flaky or mis-collected tests; adding coverage or async tests.

## Project conventions to detect first

1. Config: `[tool.pytest.ini_options]` in `pyproject.toml`, else `pytest.ini`, `tox.ini`, `setup.cfg`. Note `testpaths`, `addopts`, `markers`, `asyncio_mode`, `filterwarnings`, `pythonpath`.
2. Layout: `tests/` beside `src/` (src layout, package installed with `pip install -e .`) vs tests inside the package. Check for `tests/__init__.py` (affects `rootdir`/import mode) and `--import-mode=importlib`.
3. Installed plugins: `pytest-asyncio`/`anyio`, `pytest-mock`, `pytest-cov`, `pytest-xdist`, `pytest-django`, `pytest-httpx`/`responses`/`respx`, `hypothesis`, `freezegun`/`time-machine`, `factory_boy`.
4. Runner: `uv run pytest`, `poetry run pytest`, `hatch test`, `tox`, `nox`, `make test`. Use the same entry point.
5. Fixture style: existing `conftest.py` fixtures (db session, client, settings), naming, use of `autouse`, factories, and how external services are faked.

## Core guidance

### Configuration

```toml
[tool.pytest.ini_options]
minversion = "8.0"
testpaths = ["tests"]
addopts = "-ra -q --strict-markers --strict-config"
xfail_strict = true
filterwarnings = ["error", "ignore::DeprecationWarning:somelib.*"]
markers = [
  "slow: long-running tests, deselect with -m 'not slow'",
  "integration: needs external services",
]
asyncio_mode = "auto"        # pytest-asyncio
```

- `--strict-markers` turns typos in `@pytest.mark.foo` into errors; register every marker.
- `filterwarnings = ["error"]` surfaces deprecations early; add targeted ignores.
- Do not put `-x`, `-s` or `--pdb` in `addopts`.

### Fixtures

```python
# tests/conftest.py
import pytest

@pytest.fixture(scope="session")
def engine():
    engine = create_engine(TEST_DB_URL)
    yield engine
    engine.dispose()

@pytest.fixture
def session(engine):
    conn = engine.connect()
    tx = conn.begin()
    yield Session(bind=conn)
    tx.rollback()
    conn.close()

@pytest.fixture
def user(session):
    return UserFactory(session=session)
```

- Scopes: `function` (default), `class`, `module`, `package`, `session`. Expensive setup goes session-scoped with per-test rollback or reset; never share mutable state across tests without cleanup.
- Use `yield` for teardown; avoid `request.addfinalizer` unless registering several.
- `conftest.py` fixtures are visible to the directory tree below; keep shared fixtures in `tests/conftest.py`, domain-specific ones in subfolders.
- `autouse=True` only for genuinely global concerns (env reset, warning filters). Prefer explicit fixture arguments.
- Fixture factories: return a function (`def make_user(**kw): ...`) when a test needs several objects.
- Built-ins: `tmp_path` / `tmp_path_factory` (never `tmpdir`), `monkeypatch`, `capsys`/`capfd`, `caplog`, `recwarn`, `request`.

### Parametrize and markers

```python
@pytest.mark.parametrize(
    ("qty", "total"),
    [(1, 100), (3, 300), pytest.param(0, 0, id="zero", marks=pytest.mark.xfail(reason="bug #12"))],
)
def test_total(qty, total):
    assert price(qty) == total
```

- Use `ids=` or `pytest.param(..., id=...)` for readable test IDs. Stack `parametrize` decorators for cartesian products.
- Parametrize fixtures with `@pytest.fixture(params=[...])` when the setup differs, not just inputs.
- `@pytest.mark.skipif(sys.platform == "win32", reason=...)`, `@pytest.mark.xfail(strict=True)`, custom markers for selection: `pytest -m "not slow"`.

### Mocking

```python
def test_fetch(monkeypatch):
    monkeypatch.setenv("API_URL", "http://test")
    monkeypatch.setattr("app.client.httpx.get", lambda url, **kw: FakeResponse(200))
    assert fetch() == ...

def test_send(mocker):                       # pytest-mock
    send = mocker.patch("app.orders.send_email", autospec=True)
    create_order(...)
    send.assert_called_once_with(to="a@b.c")
```

- Patch where the name is looked up (`app.orders.send_email`), not where it is defined.
- `autospec=True` so wrong signatures fail. Prefer `monkeypatch` for env/attrs/paths; `mocker.patch` for call assertions; both auto-undo.
- Avoid `unittest.mock.patch` decorators stacking order confusion; `mocker` keeps it explicit.
- For HTTP, use `respx` (httpx), `responses` (requests) or `pytest-httpserver`; for time use `time-machine`/`freezegun`.

### Async tests

```python
import pytest

@pytest.mark.asyncio          # unnecessary with asyncio_mode = "auto"
async def test_fetch_user(client):
    resp = await client.get("/users/1")
    assert resp.status_code == 200

@pytest.fixture
async def client():
    async with AsyncClient(app=app, base_url="http://test") as c:
        yield c
```

- pytest-asyncio: set `asyncio_mode = "auto"` or mark tests; async fixtures need `@pytest_asyncio.fixture` in strict mode. Fixture loop scope is configured with `loop_scope=` (0.24+) and `asyncio_default_fixture_loop_scope` in config; check `pip show pytest-asyncio` for the version.
- If the project uses `anyio`, mark with `@pytest.mark.anyio` instead; do not mix both plugins.

### Assertions and output

- Plain `assert` with pytest's rewriting; for floats use `pytest.approx`; for exceptions `with pytest.raises(ValueError, match=r"empty")`; for warnings `pytest.warns`.
- `caplog.set_level(logging.INFO)` then inspect `caplog.records`; `capsys.readouterr()` for stdout.

## Common tasks

### Run tests

```bash
pytest                                   # per config
pytest tests/test_orders.py::test_total  # one test
pytest -k "total and not slow"           # keyword filter
pytest -m integration
pytest -x --lf                           # stop at first failure, rerun last failed
pytest -n auto                           # parallel with pytest-xdist
pytest --cov=src --cov-report=term-missing --cov-fail-under=80
pytest --pdb                             # drop into debugger on failure
pytest --durations=10                    # slowest tests
pytest --collect-only -q                 # what would run
```

### Add tests for a new module

1. Create `tests/<area>/test_<module>.py` mirroring `src/`.
2. Reuse fixtures from `conftest.py`; add new shared ones there, local ones in the test module.
3. Cover the happy path, edge cases via `parametrize`, and error paths with `pytest.raises`.
4. Run `pytest tests/<area> -q` then the full suite.

### Test a CLI or filesystem code

- `tmp_path` for files; `monkeypatch.chdir(tmp_path)` for cwd; `capsys` for output; `CliRunner` (click/typer) for commands.

### Set up coverage

```bash
pip install pytest-cov
```

```toml
[tool.coverage.run]
source = ["src"]
branch = true
[tool.coverage.report]
fail_under = 80
show_missing = true
```

Run `pytest --cov`; combine with xdist via `--cov` on the main process (pytest-cov handles workers).

### Make a slow suite faster

1. `pytest --durations=20` to find hot spots.
2. Promote expensive fixtures to `session` scope with proper reset; use transaction rollback for DB tests.
3. `pytest -n auto` (xdist); ensure tests do not share files/ports (`tmp_path`, `worker_id` fixture).
4. Mark heavy tests `slow`/`integration` and exclude by default locally.

## Pitfalls

- Tests importing the package from the working tree instead of the installed one; use src layout plus `pip install -e .` or `pythonpath = ["src"]`.
- Missing `__init__.py` in nested `tests/` dirs with duplicate basenames causes "import file mismatch"; use `--import-mode=importlib` or unique names.
- Session fixtures that mutate shared state leak between tests and change results under `-p randomly` or xdist.
- `assert` on mock call args with wrong patch target passes silently when `autospec` is omitted and the real function ran.
- `xfail` without `strict=True` hides fixed bugs; `skip` without `reason` hides intent.
- Async fixtures declared with `@pytest.fixture` in strict mode yield coroutine objects; use `@pytest_asyncio.fixture`.
- `time.sleep` in tests; fake time or poll with a timeout.
- `--cov` with `-n` reporting 0% means `pytest-cov` is missing or `source` is misconfigured.
- Running `python -m pytest` vs `pytest` differs in `sys.path` (the former adds cwd); match what CI does.
- Unregistered markers silently ignored without `--strict-markers`.

## Verification

```bash
pytest -q                                   # all pass
pytest --cov=src --cov-report=term-missing  # coverage threshold met
ruff check . && ruff format --check .       # or flake8/black, per repo
mypy src tests                              # if the repo type-checks tests
```

## References

- pytest docs: https://docs.pytest.org/en/stable/
- Fixtures: https://docs.pytest.org/en/stable/how-to/fixtures.html
- Parametrize: https://docs.pytest.org/en/stable/how-to/parametrize.html
- monkeypatch: https://docs.pytest.org/en/stable/how-to/monkeypatch.html
- Configuration: https://docs.pytest.org/en/stable/reference/customize.html
- pytest-asyncio: https://pytest-asyncio.readthedocs.io/
- pytest-mock: https://pytest-mock.readthedocs.io/
- pytest-cov: https://pytest-cov.readthedocs.io/
