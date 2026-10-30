---
name: flask
description: Build and maintain Flask 3.x applications with the application factory pattern, blueprints, configuration classes, extensions (Flask-SQLAlchemy, Flask-Migrate, Flask-Login, Flask-WTF), request handling, error handlers, CLI commands and testing with the test client. Use when a Python project depends on flask or when editing files that import from flask, create_app factories, blueprints, or wsgi.py.
---

# Flask

Assumes Flask 3.x (Werkzeug 3, Python 3.9+), Flask-SQLAlchemy 3.1 with SQLAlchemy 2.0 style, and the application-factory pattern. Flask 2.3+ removed `before_first_request` and `flask.json` module-level encoders; check the installed version before using older tutorials.

## When to use

- Adding routes, blueprints, templates, forms, error handlers, CLI commands or extensions.
- Configuring the app for dev/test/prod, database models and migrations.
- Writing tests with `app.test_client()`.
- Not for FastAPI/Django projects; for Flask-based APIs with OpenAPI, check for `flask-smorest`, `apiflask` or `flask-restx` first.

## Project conventions to detect first

1. Flask and extension versions in `pyproject.toml`/`requirements.txt`: `flask-sqlalchemy`, `flask-migrate`, `flask-login`, `flask-wtf`, `flask-cors`, `flask-caching`, `flask-limiter`, `flask-marshmallow`/`marshmallow`, `flask-smorest`, `celery`, `gunicorn`/`waitress`.
2. Factory: `create_app(config_name|config_object)` in `app/__init__.py` (or `src/<pkg>/__init__.py`); extensions instantiated in `app/extensions.py` and bound with `init_app(app)`.
3. Entry point: `wsgi.py` / `run.py` exposing `app`, `FLASK_APP` in `.flaskenv`, or `--app` in scripts. How debug mode is set (`flask run --debug`, never `FLASK_ENV` which was removed in 2.3).
4. Config: `config.py` with `Config`/`DevelopmentConfig`/`TestingConfig`/`ProductionConfig` classes, `app.config.from_object`, `from_prefixed_env()` (Flask 2.1+), `python-dotenv` `.env`/`.flaskenv`.
5. Blueprints: `app/<feature>/__init__.py` with `bp = Blueprint("auth", __name__, url_prefix="/auth")` and `routes.py`; templates per blueprint under `templates/<feature>/`.
6. Models: `db.Model` subclasses, SQLAlchemy 2.0 typing (`Mapped`, `mapped_column`) vs legacy `db.Column`; `migrations/` directory (Flask-Migrate/Alembic).
7. Frontend: Jinja templates (+ htmx/Tailwind/Bootstrap-Flask), or JSON API only.
8. Tests: `pytest` with `conftest.py` `app`/`client`/`db` fixtures, `pytest-flask` presence.
9. Lint/format: `ruff`, `black`, `mypy`.

## Core guidance

### Application factory

```python
# app/extensions.py
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_login import LoginManager
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

db = SQLAlchemy(model_class=Base)
migrate = Migrate()
login_manager = LoginManager()

# app/__init__.py
from flask import Flask

def create_app(config_object="config.DevelopmentConfig"):
    app = Flask(__name__, instance_relative_config=True)
    app.config.from_object(config_object)
    app.config.from_prefixed_env()          # FLASK_SECRET_KEY -> SECRET_KEY, etc.

    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)
    login_manager.login_view = "auth.login"

    from app.main import bp as main_bp
    from app.auth import bp as auth_bp
    app.register_blueprint(main_bp)
    app.register_blueprint(auth_bp)

    register_error_handlers(app)
    register_cli(app)
    return app
```

- Extensions are module-level singletons configured via `init_app`; never create them inside the factory.
- Import blueprints inside the factory to avoid circular imports (`app.auth.routes` imports `db` from `app.extensions`, not from `app`).
- `wsgi.py`: `from app import create_app; app = create_app()`; run with `flask --app wsgi run --debug` or `gunicorn wsgi:app`.

### Blueprints and routes

```python
bp = Blueprint("orders", __name__, url_prefix="/orders", template_folder="templates")

@bp.get("/")
@login_required
def index():
    page = request.args.get("page", 1, type=int)
    orders = db.paginate(db.select(Order).filter_by(user_id=current_user.id).order_by(Order.created_at.desc()), page=page, per_page=20)
    return render_template("orders/index.html", orders=orders)

@bp.post("/")
@login_required
def create():
    form = OrderForm()
    if not form.validate_on_submit():
        return render_template("orders/new.html", form=form), 400
    order = Order(user=current_user, total=form.total.data)
    db.session.add(order)
    db.session.commit()
    flash("Order created", "success")
    return redirect(url_for("orders.show", order_id=order.id))

@bp.get("/<int:order_id>")
def show(order_id: int):
    order = db.get_or_404(Order, order_id)
    return render_template("orders/show.html", order=order)
```

- Use `@bp.get/post/put/patch/delete` (Flask 2.0+) and converters (`<int:id>`, `<uuid:id>`, `<path:p>`).
- `url_for("blueprint.endpoint", **params)` everywhere; never hard-code paths.
- JSON APIs: `request.get_json()` (raises 415/400 on bad input; `silent=True` to get `None`), return `dict`/`list` (auto-jsonified) or `jsonify(...)`, with a status tuple `return {"id": 1}, 201`.
- Validate input with WTForms (`Flask-WTF`, CSRF included), `marshmallow` schemas, or `pydantic` models; return 400/422 with field errors.
- Request-scoped state on `flask.g` (`g.user`, `g.db_conn`); cleanup in `@app.teardown_appcontext`.
- `before_request`/`after_request` hooks per blueprint (`@bp.before_request`) or app-wide (`@app.before_request`). `before_first_request` no longer exists; do one-time setup in the factory or with `with app.app_context():`.

### Configuration

```python
# config.py
import os

class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only")
    SQLALCHEMY_DATABASE_URI = os.environ.get("DATABASE_URL", "sqlite:///app.db")
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True}
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"

class TestingConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite://"
    WTF_CSRF_ENABLED = False

class ProductionConfig(Config):
    SESSION_COOKIE_SECURE = True
    PREFERRED_URL_SCHEME = "https"
```

Fail fast in production when `SECRET_KEY` is missing (`if not SECRET_KEY: raise RuntimeError`). Use `instance/` folder for untracked local config (`app.config.from_pyfile("config.py", silent=True)`).

### Database (Flask-SQLAlchemy 3.1)

```python
class User(db.Model):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    orders: Mapped[list["Order"]] = relationship(back_populates="user")

user = db.session.scalar(db.select(User).where(User.email == email))
users = db.session.scalars(db.select(User).order_by(User.email)).all()
user = db.get_or_404(User, user_id)
```

- Prefer `db.session.execute(db.select(...))` over legacy `Model.query`; `db.first_or_404(select)`, `db.one_or_404`, `db.paginate(select)`.
- Commit in the view/service after all writes; rollback on exception (`try/except: db.session.rollback(); raise`). Sessions are scoped to the app context and removed automatically at teardown.
- Eager-load with `selectinload`/`joinedload` in list views to avoid N+1.
- Migrations: `flask db init` (once), `flask db migrate -m "msg"`, review `migrations/versions/*.py`, `flask db upgrade`. Import all models where the factory can see them so autogenerate detects them.

### Auth (Flask-Login)

- `class User(UserMixin, db.Model)`; `@login_manager.user_loader def load_user(user_id): return db.session.get(User, int(user_id))`.
- `login_user(user, remember=form.remember.data)`, `logout_user()`, `@login_required`, `current_user`.
- Hash passwords with `werkzeug.security.generate_password_hash`/`check_password_hash` (or `argon2-cffi`). Protect `next` redirects: validate the URL is relative (`urlsplit(next).netloc == ""`).
- Session cookie settings in config; `SESSION_PROTECTION = "strong"` where appropriate. For token APIs use `flask-jwt-extended` or `authlib`.

### Error handling

```python
from werkzeug.exceptions import HTTPException

def register_error_handlers(app):
    @app.errorhandler(404)
    def not_found(e):
        if request.accept_mimetypes.best == "application/json" or request.path.startswith("/api/"):
            return {"error": "not found"}, 404
        return render_template("errors/404.html"), 404

    @app.errorhandler(HTTPException)
    def http_error(e):
        return {"error": e.name, "description": e.description}, e.code

    @app.errorhandler(Exception)
    def unhandled(e):
        app.logger.exception("unhandled error")
        return {"error": "internal server error"}, 500
```

- Use `abort(404)` / `abort(403, description=...)` in views; raise custom `HTTPException` subclasses for domain errors with a JSON body.
- Blueprint-level `@bp.errorhandler` only catches errors raised within that blueprint; 404 for unknown routes must be app-level.
- Flask re-raises exceptions in debug/testing mode (`PROPAGATE_EXCEPTIONS`); test 500 handling with `app.config["PROPAGATE_EXCEPTIONS"] = False` if needed.
- Logging: configure `app.logger` (or `dictConfig` before `create_app`) and never leave `print` in request handlers.

### CLI

```python
import click
from flask import Flask

def register_cli(app: Flask):
    @app.cli.command("seed")
    @click.option("--count", default=10)
    def seed(count):
        """Seed demo data."""
        ...
        db.session.commit()
```

Run with `flask --app wsgi seed --count 5`. Commands run inside an app context automatically.

## Common tasks

### Create a feature blueprint

1. `app/<feature>/__init__.py` with the `Blueprint`, `routes.py`, `forms.py`, `templates/<feature>/`.
2. Register in `create_app`.
3. Add tests under `tests/test_<feature>.py`.

### Add a model and migration

1. Define the model; make sure its module is imported by the factory (e.g. `from app import models`).
2. `flask --app wsgi db migrate -m "add orders"`; review; `flask --app wsgi db upgrade`.
3. Add factories/fixtures and tests.

### Add a JSON API endpoint

1. Blueprint with `url_prefix="/api/v1"`; `request.get_json()` + schema validation.
2. Return dicts with explicit status codes; register JSON error handlers for that blueprint path.
3. Enable `flask-cors` only on the API blueprint with explicit origins.

### Write tests

```python
# tests/conftest.py
import pytest
from app import create_app
from app.extensions import db as _db

@pytest.fixture
def app():
    app = create_app("config.TestingConfig")
    with app.app_context():
        _db.create_all()
        yield app
        _db.session.remove()
        _db.drop_all()

@pytest.fixture
def client(app):
    return app.test_client()

def test_create_order(client, user):
    with client.session_transaction() as sess:
        sess["_user_id"] = str(user.id)   # or log in via POST /auth/login
    resp = client.post("/orders/", data={"total": "10.00"}, follow_redirects=True)
    assert resp.status_code == 200
    assert b"Order created" in resp.data
```

`client.get(..., json=...)`, `resp.get_json()`, `resp.status_code`, `resp.headers["Location"]`. Use `app.test_cli_runner().invoke(args=["seed"])` for CLI tests. Disable CSRF in testing config.

## Pitfalls

- Creating extensions inside `create_app` or importing `app` from modules the factory imports (circular import).
- Working outside the application context (`RuntimeError: Working outside of application context`): wrap scripts in `with app.app_context():`.
- Using removed APIs: `before_first_request`, `FLASK_ENV`, `flask.json.JSONEncoder`; `Model.query` is legacy (still works) but mixing with 2.0 style is confusing.
- Forgetting `db.session.commit()` or not rolling back after an exception, leaving the session in a failed state for the next request in the same worker.
- Catching `Exception` in handlers and returning 200.
- Hard-coded URLs instead of `url_for`; blueprint endpoint name mismatches (`bp_name.function_name`).
- CSRF disabled globally instead of only in `TestingConfig`.
- `debug=True` or the Werkzeug debugger reachable in production (RCE risk); use `gunicorn`/`waitress`, set `SESSION_COOKIE_SECURE`.
- Serving uploads from `static/` without validating filenames; use `werkzeug.utils.secure_filename` and `MAX_CONTENT_LENGTH`.
- Autogenerate migrations missing tables because models were never imported.

## Verification

```bash
flask --app wsgi routes                 # list endpoints and blueprints
flask --app wsgi db check 2>/dev/null || flask --app wsgi db migrate --dry-run 2>/dev/null   # drift check if Flask-Migrate >= 4; otherwise 'flask db migrate' and expect "No changes"
pytest -q
ruff check . && ruff format --check .
mypy app                                # if configured
flask --app wsgi run --debug            # smoke test locally
gunicorn -w 2 wsgi:app                  # production server check
```

## References

- [references/factory-and-extensions.md](references/factory-and-extensions.md): factory wiring, extension init order, context rules and test fixtures in more depth.
- Flask docs: https://flask.palletsprojects.com/en/stable/
- Application factories: https://flask.palletsprojects.com/en/stable/patterns/appfactories/
- Flask-SQLAlchemy 3.1: https://flask-sqlalchemy.readthedocs.io/en/stable/
- Flask-Migrate: https://flask-migrate.readthedocs.io/
- Flask-Login: https://flask-login.readthedocs.io/
- Testing: https://flask.palletsprojects.com/en/stable/testing/
