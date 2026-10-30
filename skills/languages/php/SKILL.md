---
name: php
description: Write, refactor and review modern PHP 8.2+ in Composer-based projects (frameworks, libraries, CLIs). Covers Composer and PSR-4 autoloading, PSR-12 style, strict types, enums, readonly classes, typed properties, exceptions, PHPUnit/Pest testing, PHPStan/Psalm static analysis and PHP-CS-Fixer. Use when editing .php files or a project with composer.json.
---

# PHP

Assumes PHP 8.2+ (readonly classes, enums, first-class callable syntax, `never`, DNF types). Check `"php"` in `composer.json` `require` and `.php-version`/`Dockerfile` before using 8.3/8.4-only features (typed class constants, `#[\Override]`, property hooks). Framework specifics (Laravel, Symfony) have their own skills; this covers the language and ecosystem.

## When to use

- Editing or creating `.php` files, `composer.json`, `phpunit.xml(.dist)`, `phpstan.neon`, `psalm.xml`, `.php-cs-fixer.dist.php`.
- Adding Composer packages, tests, static-analysis rules or CLI commands.
- Reviewing PHP for type safety, error handling, security (injection, deserialization) or structure.

## Project conventions to detect first

1. `composer.json`: `require.php` constraint, `autoload.psr-4` namespace → directory map (`"App\\": "src/"`), `autoload-dev` for tests, `scripts` (often `test`, `lint`, `analyse`, `cs-fix`), `config.platform.php`.
2. Framework: `artisan` + `bootstrap/app.php` (Laravel), `bin/console` + `config/bundles.php` (Symfony), `public/index.php` only (Slim/plain). Follow framework conventions for DI and structure.
3. Static analysis: `phpstan.neon(.dist)` with `level:` (aim for the configured level, do not lower it), `psalm.xml` with `errorLevel`. Baseline files (`phpstan-baseline.neon`) mean legacy debt; do not add to them.
4. Style: `.php-cs-fixer.dist.php` (`@PSR12`, `@Symfony`, `@PER-CS`), `phpcs.xml` (PHP_CodeSniffer), `pint.json` (Laravel Pint), `ecs.php`.
5. Tests: `phpunit.xml.dist` (PHPUnit 10/11: attributes instead of annotations) or `tests/Pest.php` (Pest). Test directory layout (`tests/Unit`, `tests/Feature`).
6. `declare(strict_types=1);` present at the top of files? Match; add it to new files always.
7. PHP runtime: Docker (`Dockerfile`, `docker-compose.yml` with `php:8.x-fpm`), `ddev`, `lando`, Herd/Valet. Run tools inside the same environment CI uses.

## Core guidance

### Types

- Start every file with `<?php` + `declare(strict_types=1);`.
- Type everything: parameters, return types (`: void`, `: never`, `: static`), properties (`private readonly string $id`), constants in 8.3+. Use union types (`int|string`), nullable `?Foo` only when null is a real state, `mixed` only at untyped boundaries.
- Constructor promotion + `readonly`:

```php
final readonly class Money
{
    public function __construct(
        public int $amount,
        public Currency $currency,
    ) {
        if ($amount < 0) {
            throw new \InvalidArgumentException('Amount must be non-negative');
        }
    }

    public function add(self $other): self
    {
        return new self($this->amount + $other->amount, $this->currency);
    }
}
```

- Backed enums for fixed sets; add methods and `from`/`tryFrom`:

```php
enum Status: string
{
    case Draft = 'draft';
    case Published = 'published';

    public function label(): string
    {
        return match ($this) {
            self::Draft => 'Draft',
            self::Published => 'Published',
        };
    }
}
```

- `match` over `switch` (strict comparison, exhaustive with `UnhandledMatchError`). Named arguments for clarity at call sites with many params. First-class callables: `array_map($this->normalize(...), $rows)`.
- Document generics and array shapes for the analyser: `/** @param list<User> $users */`, `/** @return array{id: int, name: string} */`, `@template T`.
- `final` classes by default; interfaces for extension points; `abstract` only with real shared behaviour.

### Errors

- Throw exceptions, never `trigger_error` or returning `false`. Define a per-package marker interface (`interface AppException extends \Throwable`) and concrete exceptions extending `\RuntimeException`/`\LogicException`/`\DomainException`.
- Catch narrowly; rethrow with context: `throw new ImportFailed('row 12', previous: $e)`.
- Do not use `@` error suppression. Convert warnings to exceptions where libraries allow (`JSON_THROW_ON_ERROR`, `PDO::ERRMODE_EXCEPTION`, `\ErrorException` handler in bootstrap).
- `try/finally` for cleanup; let the framework's exception handler map exceptions to HTTP responses.

### Structure

- PSR-4: one class per file, file path mirrors namespace (`src/Billing/InvoiceRenderer.php` → `App\Billing\InvoiceRenderer`). Run `composer dump-autoload` after adding namespaces.
- Constructor injection; depend on interfaces (PSR-3 `LoggerInterface`, PSR-18 `ClientInterface`, PSR-7 messages, PSR-11 container, PSR-14 events). No `new` of services inside services; no static facades in library code.
- Value objects and DTOs as `readonly` classes; collections as typed arrays (`list<T>`, `array<string, T>`) or a small collection class.
- Immutability where cheap: `with*` methods that return clones. `__clone` to deep-copy mutable members.
- Keep `public/index.php` the only web-reachable entry; everything else outside the web root.

### Security

- Parameterised queries only (PDO prepared statements, query builders); never interpolate user input into SQL, shell (`escapeshellarg` if unavoidable), or HTML (escape with `htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')` or the template engine's autoescape).
- `password_hash`/`password_verify`; `random_bytes`/`random_int`; `hash_equals` for comparing secrets.
- Never `unserialize()` untrusted input; use JSON. Validate uploads by content, not extension.
- Secrets in environment variables (`$_ENV`/`getenv` via `vlucas/phpdotenv` or the framework), not in committed config.

### Style (PSR-12 / PER-CS)

- 4 spaces, `camelCase` methods/properties, `PascalCase` classes, `UPPER_SNAKE` constants, one blank line after `declare`, `use` statements grouped and alphabetised, opening brace on its own line for classes/functions, same line for control structures.
- `[]` array syntax, trailing commas in multiline arrays and parameter lists, `?->` nullsafe operator, `??` coalescing, `str_contains`/`str_starts_with` over `strpos` checks.
- Run the fixer; do not hand-format.

## Common tasks

### Create a library

```bash
composer init --name vendor/package --type library --license MIT
mkdir -p src tests
composer require --dev phpunit/phpunit phpstan/phpstan friendsofphp/php-cs-fixer
```

Add to `composer.json`:

```json
{
  "autoload": { "psr-4": { "Vendor\\Package\\": "src/" } },
  "autoload-dev": { "psr-4": { "Vendor\\Package\\Tests\\": "tests/" } },
  "scripts": {
    "test": "phpunit",
    "analyse": "phpstan analyse",
    "cs": "php-cs-fixer fix --dry-run --diff",
    "cs-fix": "php-cs-fixer fix"
  }
}
```

Then `composer dump-autoload`.

### Add a package

```bash
composer require guzzlehttp/guzzle:^7.8       # runtime
composer require --dev pestphp/pest           # dev only
composer outdated --direct
composer update vendor/package --with-dependencies
```

Commit `composer.lock` for applications; libraries usually do not ship it. Run `composer validate` after hand-editing `composer.json`.

### Write tests

```php
// tests/MoneyTest.php (PHPUnit 10+)
declare(strict_types=1);

namespace Vendor\Package\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Vendor\Package\Money;

final class MoneyTest extends TestCase
{
    #[DataProvider('additions')]
    public function testAdd(int $a, int $b, int $expected): void
    {
        $sum = (new Money($a, Currency::EUR))->add(new Money($b, Currency::EUR));
        self::assertSame($expected, $sum->amount);
    }

    public static function additions(): iterable
    {
        yield 'small' => [1, 2, 3];
        yield 'zero' => [0, 0, 0];
    }

    public function testRejectsNegative(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new Money(-1, Currency::EUR);
    }
}
```

Pest: `it('adds money', fn () => expect((new Money(1, Currency::EUR))->add(new Money(2, Currency::EUR))->amount)->toBe(3));` in `tests/Unit/MoneyTest.php`. Mock interfaces with `$this->createMock(Interface::class)` or Mockery; avoid mocking concrete classes.

### Add static analysis

`phpstan.neon.dist`:

```neon
parameters:
    level: 8
    paths: [src, tests]
```

Run `vendor/bin/phpstan analyse`; raise `level` incrementally. Psalm: `vendor/bin/psalm --init src 4` then `vendor/bin/psalm`. Fix findings with real types rather than `@phpstan-ignore` lines.

### Add a console command

Use `symfony/console`: a class extending `Command` with `#[AsCommand(name: 'app:import')]`, `configure()` for arguments/options, `execute(InputInterface $input, OutputInterface $output): int` returning `Command::SUCCESS`/`FAILURE`. Register it in `bin/console` (or Laravel's `app/Console/Commands` with `artisan`).

## Pitfalls

- Loose comparison `==` (`"abc" == 0` was true before PHP 8; `"1" == "01"` still is). Use `===` and `in_array($x, $arr, true)`.
- Missing `strict_types` lets `"5"` pass as `int`; silently coerces.
- Arrays are value types copied on write; objects are handles. Returning an internal array copies, returning an internal object exposes it.
- `empty()` treats `"0"` as empty; `isset()` is false for `null` values that exist. Use `array_key_exists` / explicit comparisons.
- `$this` captured in closures keeps objects alive; use `static fn` where `$this` is not needed.
- Float money arithmetic; use integers (cents) or `brick/money`.
- `date()`/`strtotime()` with implicit timezone; use `DateTimeImmutable` with an explicit `DateTimeZone` and never `DateTime` (mutable).
- `foreach` by reference leaving a dangling `$value` reference; `unset($value)` after or avoid references.
- Autoload failures from class/file name or namespace/directory case mismatch (case-sensitive on Linux).
- Editing `vendor/`; it is regenerated. Patch upstream or use `cweagans/composer-patches`.

## Verification

Prefer `composer run-script --list` to discover the project's scripts. Typical loop:

```bash
php -l src/Foo.php                           # syntax check a file
composer validate                            # composer.json sanity
vendor/bin/php-cs-fixer fix --dry-run --diff # style (or: vendor/bin/pint --test, vendor/bin/phpcs)
vendor/bin/phpstan analyse                   # or: vendor/bin/psalm
vendor/bin/phpunit                           # or: vendor/bin/pest
vendor/bin/phpunit --filter MoneyTest        # single class
composer audit                               # known vulnerabilities in the lock
```

Run inside the project's container (`docker compose exec app ...`) when one is defined so the PHP version and extensions match CI.

## References

- PHP manual: https://www.php.net/manual/en/
- PHP 8.2 release notes: https://www.php.net/releases/8.2/en.php
- PSR-4 autoloading: https://www.php-fig.org/psr/psr-4/
- PSR-12 / PER coding style: https://www.php-fig.org/per/coding-style/
- Composer docs: https://getcomposer.org/doc/
- PHPUnit docs: https://docs.phpunit.de/
- Pest: https://pestphp.com/docs
- PHPStan: https://phpstan.org/user-guide/getting-started
- PHP-CS-Fixer rules: https://cs.symfony.com/doc/rules/index.html
