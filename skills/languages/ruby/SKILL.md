---
name: ruby
description: Write, refactor and review Ruby 3.x code in gems, Rails apps, CLIs and scripts. Covers Bundler and Gemfile management, idiomatic Ruby (blocks, Enumerable, keyword arguments, pattern matching), error handling, RSpec/Minitest, RuboCop, Rake tasks and gem structure. Use when editing .rb files or a project with a Gemfile, .ruby-version or Rakefile.
---

# Ruby

Assumes Ruby 3.2+ (pattern matching, endless methods, `Data.define`, anonymous block/rest forwarding). Check `.ruby-version`/`.tool-versions` and `required_ruby_version` in the gemspec before using newer syntax. Rails-specific guidance belongs to the Rails skill; this covers the language and gem ecosystem.

## When to use

- Editing or creating `.rb`, `.rake`, `.gemspec`, `Gemfile`, `Rakefile`, `.rubocop.yml` files.
- Adding gems, Rake tasks, tests, or releasing a gem.
- Reviewing Ruby for idiom, error handling, performance or test coverage.

## Project conventions to detect first

1. Ruby version: `.ruby-version`, `.tool-versions` (asdf/mise), `ruby "3.x"` in `Gemfile`. Use the version manager present (`rbenv`, `rvm`, `asdf`, `mise`); run `ruby -v` to confirm.
2. `Gemfile` + `Gemfile.lock`: groups (`:development`, `:test`), the test framework (`rspec`, `minitest`), linters (`rubocop`, `rubocop-rspec`, `rubocop-performance`, `standard`), type tools (`sorbet`, `rbs`, `steep`), `dotenv`, `pry`/`debug`.
3. Project kind: `*.gemspec` + `lib/<gem>.rb` + `lib/<gem>/version.rb` (gem); `config/application.rb` (Rails); `bin/` executables; `exe/` for gem executables.
4. Test layout: `spec/` with `spec_helper.rb`/`.rspec` (RSpec) or `test/` with `test_helper.rb` (Minitest). Factories (`factory_bot`), fixtures, `vcr`/`webmock` for HTTP.
5. `.rubocop.yml`: `TargetRubyVersion`, inherited configs (`standard`, `rubocop-rails`), disabled cops. Run RuboCop rather than guessing style; `# frozen_string_literal: true` magic comment presence.
6. `Rakefile`: `rake -T` lists tasks; default task is usually tests + lint.
7. Boundaries: `Zeitwerk` autoloading (Rails/gems using `loader = Zeitwerk::Loader.for_gem`) requires file names to match constant names (`lib/my_gem/http_client.rb` → `MyGem::HttpClient`).

## Core guidance

### Idioms

- Two-space indentation, `snake_case` methods/variables, `CamelCase` classes, `SCREAMING_SNAKE` constants, predicate methods end in `?`, dangerous (mutating/raising) variants in `!`.
- `# frozen_string_literal: true` at the top of every file (unless RuboCop config says otherwise).
- Prefer keyword arguments for methods with more than two parameters or boolean flags: `def send_email(to:, subject:, body: "", cc: [])`.
- Return early with guard clauses; avoid `unless ... else`; avoid nested ternaries.
- Use `attr_reader` and private helpers over instance-variable access scattered through methods. `private` applies to everything below it; `private attr_reader :x` works in Ruby 3.
- Immutable value objects: `Data.define(:x, :y)` (Ruby 3.2+) or `Struct.new(:x, :y, keyword_init: true)` with `freeze`.
- String formatting: interpolation `"#{name}"`, `format("%.2f", n)`; heredocs `<<~SQL` (squiggly strips indentation).
- Symbols for identifiers/keys, strings for text. `%w[a b]`, `%i[a b]` for literal arrays.
- Safe navigation `user&.email` sparingly; it hides nil where nil should not exist.

### Blocks and Enumerable

- Reach for `Enumerable` before loops: `map`, `select`/`filter`, `reject`, `reduce`/`sum`, `each_with_object`, `group_by`, `partition`, `flat_map`, `zip`, `each_slice`, `tally`, `filter_map`, `sum`, `min_by`/`max_by`, `sort_by`.
- `Symbol#to_proc`: `names.map(&:upcase)`. Numbered params `_1` or `it` (Ruby 3.4) for one-liners only.
- Lazy chains for large/infinite sequences: `(1..).lazy.map { _1 * 2 }.select(&:even?).first(10)`.
- Write methods that yield: `def with_retries(times: 3) = ...; yield ...` and accept explicit `&block` only when storing or forwarding it. Anonymous forwarding: `def wrap(...) = inner(...)`.
- Implement `each` + `include Enumerable` for custom collections; implement `<=>` + `include Comparable` for ordering.

### Pattern matching (Ruby 3)

```ruby
case response
in { status: 200, body: { data: Array => items } }
  items
in { status: 404 }
  []
in { status: 500.., body: }
  raise ServerError, body
end
```

Use `in` with `=>` to bind, `^var` to pin, `deconstruct`/`deconstruct_keys` on your own classes.

### Error handling

- Define a hierarchy: `class MyGem::Error < StandardError; end` and subclasses; never raise or rescue bare `Exception`.
- `rescue SpecificError => e` as narrowly as possible; re-raise with `raise` (keeps backtrace) or wrap with `raise WrapperError, "context", cause: e` (the `cause` is attached automatically when raised inside a `rescue`).
- `ensure` for cleanup; `retry` with a counter; `begin/end while` is rarely right.
- Avoid using exceptions for control flow; return `nil`, a result object, or use `Integer(str, exception: false)`-style APIs.
- Do not swallow errors: `rescue => e; nil` without logging is a bug.

### Structure and OOP

- One class/module per file, mirroring the namespace path. Keep files under a few hundred lines; extract collaborators.
- Prefer composition and small objects (service objects, query objects, value objects) over deep inheritance and `method_missing`. If you use `method_missing`, define `respond_to_missing?`.
- Modules for shared behaviour (`include`), class-level behaviour (`extend`), `Module#prepend` for wrapping; avoid monkey-patching core classes outside a clearly named `core_ext` with `refine` where possible.
- Dependencies via constructor arguments with sensible defaults: `def initialize(http: Net::HTTP, clock: Time)`.
- Use `Comparable`, `Enumerable`, `to_s`, `inspect`, `==`/`eql?`/`hash` for well-behaved objects.
- Concurrency: `Thread`, `Queue`, `Mutex`, or `concurrent-ruby`; `Ractor` is experimental. Keep shared state out of threads.

## Common tasks

### Create a gem

```bash
bundle gem my_gem --test=rspec --linter=rubocop --ci=github
```

Produces `lib/my_gem.rb`, `lib/my_gem/version.rb`, `my_gem.gemspec`, `spec/`, `Rakefile`, `bin/setup`, `bin/console`. Fill in `spec.summary`, `spec.homepage`, `spec.required_ruby_version`, `spec.files` (usually via `git ls-files`), and add runtime deps with `spec.add_dependency "faraday", "~> 2.9"`; dev deps go in the `Gemfile`.

### Add a gem

```bash
bundle add rubocop-performance --group development   # edits Gemfile + lock
bundle install
bundle outdated            # what can move
bundle update <gem>        # conservative single-gem bump
```

Pin with pessimistic operator `~> 1.4` for libraries. Commit `Gemfile.lock` for apps; gems typically commit it too but it is not shipped.

### Write tests

```ruby
# spec/my_gem/parser_spec.rb
RSpec.describe MyGem::Parser do
  subject(:parser) { described_class.new(strict: true) }

  describe "#parse" do
    it "returns a hash for valid input" do
      expect(parser.parse("a=1")).to eq({ "a" => "1" })
    end

    it "raises on malformed input" do
      expect { parser.parse("==") }.to raise_error(MyGem::ParseError, /malformed/)
    end
  end
end
```

Minitest: `class ParserTest < Minitest::Test; def test_parses; assert_equal({...}, Parser.new.parse("a=1")); end; end` or spec-style `describe`/`it`/`_(x).must_equal`. Use `let` sparingly; prefer plain methods when setup is complex. Stub HTTP with `webmock`; freeze time with `Timecop` or `ActiveSupport::Testing::TimeHelpers`.

### Add a Rake task

```ruby
# lib/tasks/data.rake (Rails) or Rakefile
namespace :data do
  desc "Reindex all documents"
  task reindex: :environment do |_t, args|
    Document.find_each(&:reindex!)
  end
end
```

Run with `bundle exec rake data:reindex`; pass args as `rake "data:import[path]"` with `task :import, [:path]`.

### Add a CLI executable

- Gem: put `exe/my_gem` (shebang `#!/usr/bin/env ruby`, `require "my_gem/cli"`), set `spec.bindir = "exe"` and `spec.executables`. Use `OptionParser` (stdlib), `thor` or `dry-cli`.
- Exit with non-zero on failure (`exit 1` or `abort "message"`); write errors to `$stderr`.

### Release a gem

`bundle exec rake release` (from bundler's gem tasks) bumps nothing by itself: update `version.rb`, update `CHANGELOG.md`, commit, then run it to tag and push to RubyGems. Check `gem signin` first.

## Pitfalls

- Mutating a default argument or a constant: `DEFAULTS = {}.freeze`; `def f(opts = {})` then `opts.merge!` mutates the caller's hash. Use `dup`/`merge`.
- `and`/`or`/`not` have low precedence; use `&&`/`||`/`!`.
- `rescue` modifiers (`x = risky rescue nil`) hide errors; avoid.
- String vs symbol keys from JSON/YAML (`JSON.parse(s, symbolize_names: true)`); `Hash#fetch` for required keys.
- Forgetting `require` for stdlib (`require "json"`, `"set"` is autoloaded in 3.2+, `"time"` for `Time.parse`).
- Zeitwerk naming mismatches (`HTTPClient` vs `http_client.rb`); configure inflections rather than renaming constants.
- Thread-unsafe class-level mutable state (`@@cache`, class instance variables mutated at runtime).
- `Array#include?` in loops (O(n²)); use a `Set`.
- `puts` debugging left behind; use the `debug` gem (`binding.break`) or `pry` and remove it.
- Running `rubocop -a`/`-A` blindly over unrelated files; limit autocorrect to files you changed.

## Verification

```bash
bundle exec rake -T                 # discover tasks; default usually runs tests + lint
bundle exec rspec                   # or: bundle exec rake test / bin/rails test
bundle exec rspec spec/my_gem/parser_spec.rb:12     # single example
bundle exec rubocop                 # or: bundle exec standardrb
bundle exec rubocop -a path/to/changed_file.rb       # safe autocorrect
bundle exec srb tc                  # if Sorbet; `steep check` if RBS/Steep
gem build my_gem.gemspec            # gems: confirm the gemspec is valid
```

Check `.github/workflows/*.yml` or `.gitlab-ci.yml` for the exact matrix and commands CI runs.

## References

- Ruby documentation: https://docs.ruby-lang.org/en/master/
- Ruby style guide: https://rubystyle.guide/
- RuboCop docs: https://docs.rubocop.org/rubocop/
- Bundler docs: https://bundler.io/docs.html
- RubyGems guides (making a gem): https://guides.rubygems.org/make-your-own-gem/
- RSpec docs: https://rspec.info/documentation/
- Minitest: https://github.com/minitest/minitest
