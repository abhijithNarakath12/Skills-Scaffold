---
name: pydantic
description: Model and validate data with Pydantic v2 - BaseModel and Field, field_validator/model_validator, pydantic-settings for configuration, serialization with model_dump/model_dump_json and computed fields, strict vs lax mode, TypeAdapter, performance tips, and v1-to-v2 migration gotchas. Load when a Python project depends on pydantic or pydantic-settings, or when defining request/response models (FastAPI), config classes, or validating external data.
---

# Pydantic v2

Assumes Pydantic 2.x (2.5+) on Python 3.9+ (3.10+ preferred for `X | None`). Pydantic 1.x code is recognisable by `@validator`, `class Config`, `.dict()`, `.parse_obj()`; it still runs under `pydantic.v1` but do not write new code with it.

## When to use

- Defining data models for API requests/responses (FastAPI, Litestar), message payloads, config files, LLM structured output.
- Adding validation rules, defaults, aliases, or custom types.
- Loading settings from env vars/.env/secrets with `pydantic-settings`.
- Serializing models to JSON/dicts with control over inclusion, aliases, and formats.
- Migrating v1 code, or debugging validation performance.

## Project conventions to detect first

1. Version: `pydantic` `>=2` in `pyproject.toml`/requirements; `pydantic-settings` as a separate package (v2 moved `BaseSettings` there). `pydantic.v1` imports mark unmigrated code.
2. Base model conventions: a shared `class Base(BaseModel): model_config = ConfigDict(...)` (e.g. `from_attributes=True`, `populate_by_name=True`, `extra='forbid'`, `alias_generator=to_camel`). Subclass it rather than repeating config.
3. Where models live: `schemas/` (FastAPI convention, DTOs) vs `models/` (ORM); naming suffixes (`UserCreate`, `UserRead`, `UserUpdate`).
4. Settings: `config.py`/`settings.py` with `BaseSettings`, `SettingsConfigDict(env_file='.env', env_prefix='APP_')`, and a cached `get_settings()`.
5. Framework integration: FastAPI `response_model`, `Depends`, `Annotated[...]` with `Query`/`Body`; SQLModel; `pydantic-ai`/`instructor` for LLM outputs.
6. Type checking: mypy with `pydantic.mypy` plugin or pyright; `dataclasses` vs `BaseModel` mix.
7. Serialization conventions: camelCase aliases for frontend JSON, `exclude_none`, datetime formats.

## Core guidance

### Models and fields

```python
from datetime import datetime
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, EmailStr, HttpUrl
from pydantic.alias_generators import to_camel

class Base(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid", str_strip_whitespace=True)

class UserCreate(Base):
    email: EmailStr
    display_name: Annotated[str, Field(min_length=1, max_length=50)]
    age: Annotated[int, Field(ge=0, le=150)] | None = None
    role: Literal["user", "admin"] = "user"
    website: HttpUrl | None = None
    tags: list[str] = Field(default_factory=list)

class UserRead(Base):
    model_config = ConfigDict(from_attributes=True)     # build from ORM objects: UserRead.model_validate(orm_user)
    id: int
    email: EmailStr
    created_at: datetime
```

- Prefer `Annotated[type, Field(...)]` for constraints; `Field(default, ...)` when the default is the main thing. Mutable defaults need `default_factory`.
- `Optional[X]`/`X | None` does not make a field optional; only a default does. `X | None` with no default is required-but-nullable.
- Aliases: `Field(alias='userName')` for input, `serialization_alias`/`validation_alias` to split, `alias_generator=to_camel` for whole models; set `populate_by_name=True` to allow Python names too (renamed `validate_by_name` in 2.11+, old name still works).
- `extra='forbid'` for request bodies (catch typos), `'ignore'` (default) for tolerant readers, `'allow'` for pass-through payloads.
- `from_attributes=True` (v1 `orm_mode`) to read ORM/dataclass instances.
- Constrained/semantic types: `EmailStr` (needs `email-validator`), `HttpUrl`, `AwareDatetime`, `PositiveInt`, `SecretStr` (masked in repr/dumps), `conlist` via `Annotated[list[int], Field(min_length=1)]`.
- Discriminated unions: `Annotated[Cat | Dog, Field(discriminator='kind')]` for fast, clear errors.
- Generic models: `class Page(BaseModel, Generic[T]): items: list[T]`.
- Immutable models: `ConfigDict(frozen=True)`; hashable and safe as dict keys.

### Validators

```python
from pydantic import field_validator, model_validator, ValidationInfo

class Signup(BaseModel):
    username: str
    password: str
    confirm: str

    @field_validator("username")
    @classmethod
    def normalise(cls, v: str) -> str:
        return v.lower()

    @field_validator("password", mode="before")            # runs before type coercion; v may be anything
    @classmethod
    def strip_pw(cls, v):
        return v.strip() if isinstance(v, str) else v

    @model_validator(mode="after")
    def passwords_match(self):                              # 'after': receives the model instance
        if self.password != self.confirm:
            raise ValueError("passwords do not match")
        return self
```

- `field_validator` is a classmethod; `mode='after'` (default) receives the parsed value, `'before'` the raw input, `'wrap'` both via a handler. Validate several fields with `@field_validator('a', 'b')`; `'*'` for all.
- Raise `ValueError` (or `AssertionError`/`PydanticCustomError`); never `ValidationError` directly. Return the (possibly transformed) value.
- `model_validator(mode='before')` is a classmethod receiving the raw dict (useful to rename legacy keys); `mode='after'` is an instance method returning `self`.
- Access other fields in a field validator via `info: ValidationInfo` -> `info.data` (only fields validated so far, in declaration order).
- Reusable validation via `Annotated` types: `PositiveEven = Annotated[int, AfterValidator(check_even)]`; also `BeforeValidator`, `WrapValidator`, `PlainValidator`.
- `validate_default=True` if defaults must pass validators (off by default). `validate_assignment=True` to re-validate on attribute set.

### Parsing and strict mode

- `Model.model_validate(data)` for dict/objects, `Model.model_validate_json(raw_bytes_or_str)` for JSON (faster than `json.loads` + validate), `Model(**data)` for kwargs.
- Lax mode (default) coerces `"42"` -> 42, `1` -> `True`, ISO strings -> datetime. Strict mode (`ConfigDict(strict=True)`, `Field(strict=True)`, or `model_validate(data, strict=True)`) rejects type mismatches; JSON parsing in strict mode still accepts strings for datetimes/UUIDs since JSON has no such types.
- Non-model types: `TypeAdapter(list[UserRead]).validate_python(rows)` / `.validate_json()` / `.dump_json()`; create adapters once at module level (building is expensive).
- Catch `pydantic.ValidationError`; `e.errors()` returns `[{type, loc, msg, input, ...}]`; `e.json()` for APIs. FastAPI converts it to 422 automatically for request models.

### Serialization

```python
user.model_dump()                                     # dict with Python objects (datetime stays datetime)
user.model_dump(mode="json")                          # JSON-compatible dict (datetime -> str)
user.model_dump_json(by_alias=True, exclude_none=True, indent=2)
user.model_dump(include={"id", "email"}, exclude={"tags"})
user.model_copy(update={"role": "admin"})             # v1: .copy(update=)
```

- `by_alias=True` to emit aliases (camelCase for frontends); FastAPI uses aliases by default in responses when `response_model_by_alias=True` (default). Pydantic 2.11+ allows `ConfigDict(serialize_by_alias=True)`.
- Custom output: `@field_serializer('created_at')` / `@model_serializer`, or `Annotated[..., PlainSerializer(fn)]`. `@computed_field` adds derived properties to dumps and schema.
- `SecretStr`/`SecretBytes` dump as `'**********'`; call `.get_secret_value()` deliberately.
- Round-trip of unions: set `serialize_as_any=True` or use `SerializeAsAny[T]` when you want subclass fields included (v2 serializes by the declared type by default; a common v1->v2 surprise).
- JSON Schema: `Model.model_json_schema()`; `json_schema_extra` in `Field`/`ConfigDict` for examples and OpenAPI docs.

### Settings (pydantic-settings)

```python
from functools import lru_cache
from pydantic import Field, PostgresDsn, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", env_prefix="APP_", extra="ignore", env_nested_delimiter="__")

    database_url: PostgresDsn
    secret_key: SecretStr
    debug: bool = False
    allowed_hosts: list[str] = Field(default_factory=lambda: ["localhost"])   # env: APP_ALLOWED_HOSTS='["a","b"]' (JSON)

@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- Priority: init kwargs > env vars > `.env` > file secrets (`secrets_dir`) > defaults. Env var names are case-insensitive by default (`case_sensitive=True` to change).
- List/dict fields are parsed from JSON strings in env vars; nested models use `env_nested_delimiter`.
- `.env` is for local dev; do not commit secrets. In tests override with `Settings(_env_file=None, database_url=...)` or `monkeypatch.setenv`, and clear `get_settings.cache_clear()`.
- CLI parsing, TOML/YAML/JSON sources: `CliSettingsSource`, `TomlConfigSettingsSource`, `YamlConfigSettingsSource` via `settings_customise_sources`.

### Performance

- Validation runs in Rust (pydantic-core); the slow part is building models/`TypeAdapter`s and Python validators. Build once at import, avoid `create_model` or `TypeAdapter(...)` inside functions.
- Prefer `model_validate_json` over `json.loads` + `model_validate`; prefer `Annotated` constraints over Python validators; prefer discriminated unions over plain unions.
- Nested models with `from_attributes` on ORM objects can trigger lazy loads; select needed relations first.
- `defer_build=True` for rarely used models in large apps to speed startup; `model_rebuild()` when forward refs need resolution.
- Use `model_construct()` only for trusted data (skips validation).

### v1 -> v2 migration gotchas

| v1 | v2 |
|---|---|
| `class Config:` | `model_config = ConfigDict(...)` |
| `@validator('x')` / `@root_validator` | `@field_validator('x')` (+ `@classmethod`) / `@model_validator(mode=...)` |
| `.dict()`, `.json()`, `.copy()` | `.model_dump()`, `.model_dump_json()`, `.model_copy()` |
| `parse_obj`, `parse_raw`, `from_orm` | `model_validate`, `model_validate_json`, `model_validate(obj)` with `from_attributes=True` |
| `orm_mode = True` | `from_attributes=True` |
| `allow_population_by_field_name` | `populate_by_name` (`validate_by_name` in 2.11+) |
| `schema()` / `schema_json()` | `model_json_schema()` |
| `__fields__` | `model_fields` (class attribute; instance access deprecated in 2.11) |
| `BaseSettings` in pydantic | `pydantic_settings.BaseSettings` |
| `Optional[int]` without default was optional | required (must set `= None`) |
| `conint`, `constr` | still exist but prefer `Annotated[int, Field(ge=0)]` |
| int -> str coercion (`123` -> `"123"`) | rejected; strings are not coerced from numbers |
| `each_item=True` | validate the inner type via `Annotated[list[Annotated[int, AfterValidator(f)]], ...]` |
| Union: left-to-right first match | "smart" mode picks the best match; use discriminators for determinism |

Run `bump-pydantic` (`pip install bump-pydantic && bump-pydantic src/`) to automate most renames, then fix validators and defaults by hand.

## Common tasks

### Add a request/response model pair (FastAPI)

1. `schemas/user.py`: `UserCreate` (strict input, `extra='forbid'`), `UserRead` (`from_attributes=True`), `UserUpdate` (all optional).
2. Route: `@router.post('/users', response_model=UserRead, status_code=201) def create(payload: UserCreate, ...)`; return the ORM object and let `response_model` serialize.
3. Test invalid payloads expect 422 and check `detail[0]['loc']`.

### Validate config at startup

Create `Settings` as above; import `get_settings()` where needed; fail fast on missing variables (the `ValidationError` message lists them).

### Parse a list of records from JSON

`adapter = TypeAdapter(list[Record])` at module level; `records = adapter.validate_json(payload)`.

### Add a cross-field rule

`@model_validator(mode='after')` returning `self`; raise `ValueError` with a message. For a field that depends on an earlier field use `field_validator` + `info.data`.

## Pitfalls

- Forgetting `@classmethod` under `@field_validator` (v2 requires it; errors are confusing).
- Declaring `x: int | None` and expecting it to be optional; add `= None`.
- Validators that forget to `return` the value (field becomes `None`).
- Calling `TypeAdapter`/`create_model` per request; slow.
- `model_dump()` (Python mode) handed to `json.dumps` fails on datetimes; use `mode='json'` or `model_dump_json()`.
- Serializing a subclass instance through a parent-typed field drops subclass fields (use `SerializeAsAny`).
- `extra='allow'` on input models silently accepting attacker-controlled keys that later get persisted.
- Mixing `pydantic.v1` and v2 models in one hierarchy; they are incompatible.
- Settings read at import time in modules imported by tests, before `monkeypatch` runs; use a cached getter.
- Numbers from JSON into `str` fields now fail; coerce explicitly with `BeforeValidator(str)` if required.
- Treating `ValidationError.errors()` `loc` as a string; it is a tuple of path segments.

## Verification

```bash
pytest -q                  # model tests: valid, invalid (assert loc/type), serialization round-trips
mypy . | pyright           # with pydantic.mypy plugin configured in pyproject.toml if used
ruff check .
python -c "from app.config import get_settings; print(get_settings().model_dump())"   # settings load check (secrets masked)
```

## References

- Pydantic docs: https://docs.pydantic.dev/latest/
- Validators: https://docs.pydantic.dev/latest/concepts/validators/
- Serialization: https://docs.pydantic.dev/latest/concepts/serialization/
- pydantic-settings: https://docs.pydantic.dev/latest/concepts/pydantic_settings/
- Migration guide v1 -> v2: https://docs.pydantic.dev/latest/migration/
- Performance tips: https://docs.pydantic.dev/latest/concepts/performance/
