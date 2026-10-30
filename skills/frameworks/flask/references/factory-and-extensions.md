# Flask factory, extensions and contexts

## Recommended layout

```
project/
├── app/
│   ├── __init__.py        # create_app()
│   ├── extensions.py      # db, migrate, login_manager, csrf, cache, limiter, cors
│   ├── models/            # or models.py; imported by the factory for Alembic
│   ├── main/              # bp + routes.py + templates/main/
│   ├── auth/              # bp + routes.py + forms.py
│   ├── api/               # bp with url_prefix /api/v1, JSON error handlers
│   ├── templates/base.html
│   └── static/
├── migrations/            # Flask-Migrate
├── tests/conftest.py
├── config.py
├── wsgi.py
└── .flaskenv              # FLASK_APP=wsgi  FLASK_DEBUG=1 (dev only)
```

## Factory checklist

1. `Flask(__name__, instance_relative_config=True)`; `os.makedirs(app.instance_path, exist_ok=True)` if instance files are written.
2. Config: `from_object` (class), then `from_pyfile("config.py", silent=True)` (instance overrides), then `from_prefixed_env()` (environment wins).
3. `ext.init_app(app)` for every extension; order matters only when one depends on another (Flask-Migrate after Flask-SQLAlchemy; Flask-Limiter storage before use).
4. Register blueprints (import inside the function).
5. Register error handlers, CLI commands, context processors (`@app.context_processor`), template filters (`@app.template_filter()`), shell context (`@app.shell_context_processor` returning `{"db": db, "User": User}`).
6. Logging: configure with `logging.config.dictConfig` before creating the app so Flask's default handler is not added.
7. Behind a proxy: `app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)` so `request.remote_addr` and `url_for(_external=True)` are right.
8. Return `app`.

## Common extension init

```python
# extensions.py
db = SQLAlchemy(model_class=Base)
migrate = Migrate()
login_manager = LoginManager()
csrf = CSRFProtect()
cache = Cache()
limiter = Limiter(key_func=get_remote_address, default_limits=["200/hour"])
cors = CORS()

# create_app
db.init_app(app)
migrate.init_app(app, db, render_as_batch=app.config.get("SQLALCHEMY_DATABASE_URI", "").startswith("sqlite"))  # batch mode for SQLite ALTERs
login_manager.init_app(app)
csrf.init_app(app)
cache.init_app(app)
limiter.init_app(app)
cors.init_app(app, resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}})
```

Exempt JSON API blueprints from CSRF when they use token auth: `csrf.exempt(api_bp)`.

## Contexts

- **Application context** (`app.app_context()`): needed for `current_app`, `g`, `db.session`, `url_for` outside requests. Pushed automatically during requests and CLI commands.
- **Request context**: `request`, `session`; pushed for each request. In tests, `with app.test_request_context("/path"):`.
- `g` lives for one app context (one request). Store per-request resources there and close them in `@app.teardown_appcontext`.
- Background threads do not inherit contexts; pass `app` and use `with app.app_context():` inside the thread (or use Celery).

## Flask-SQLAlchemy session rules

- One scoped session per app context, removed at teardown (`db.session.remove()`), so leftover state does not leak across requests.
- After an `IntegrityError`, call `db.session.rollback()` before issuing another query.
- `db.session.get(Model, pk)` for primary key lookups; `db.get_or_404(Model, pk, description="...")` in views.
- Multiple databases: `SQLALCHEMY_BINDS = {"analytics": uri}` and `__bind_key__ = "analytics"` on models.
- Engine options via `SQLALCHEMY_ENGINE_OPTIONS`; `pool_pre_ping=True` for long-running workers.

## Test fixtures that scale

```python
@pytest.fixture(scope="session")
def app():
    app = create_app("config.TestingConfig")
    with app.app_context():
        db.create_all()
        yield app
        db.drop_all()

@pytest.fixture
def session(app):
    connection = db.engine.connect()
    transaction = connection.begin()
    db.session.configure(bind=connection)   # Flask-SQLAlchemy 3.x: session factory options
    yield db.session
    db.session.remove()
    transaction.rollback()
    connection.close()

@pytest.fixture
def client(app):
    return app.test_client()

@pytest.fixture
def auth_client(client, user):
    client.post("/auth/login", data={"email": user.email, "password": "secret"})
    return client
```

Use `app.test_client(use_cookies=True)` (default) to keep sessions across requests; `client.session_transaction()` to read/write the session directly.

## Deployment notes

- `gunicorn -w $((2*CPU+1)) -b 0.0.0.0:8000 wsgi:app` or `waitress-serve --port=8000 wsgi:app` on Windows.
- Run `flask db upgrade` as a release step, not at import time.
- Static files via `whitenoise` (`app.wsgi_app = WhiteNoise(app.wsgi_app, root="app/static/", prefix="static/")`) or a CDN/reverse proxy.
- Set `SECRET_KEY`, `SESSION_COOKIE_SECURE=True`, `PREFERRED_URL_SCHEME="https"`, and `MAX_CONTENT_LENGTH` in production config.
