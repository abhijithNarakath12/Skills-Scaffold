---
name: rails
description: Build and maintain Ruby on Rails 7.x/8 applications, covering MVC conventions, ActiveRecord (migrations, associations, scopes, N+1 with includes/preload), controllers and strong parameters, routes, Hotwire (Turbo, Stimulus), Active Job, Action Mailer, credentials, RSpec or Minitest, and rubocop-rails. Use when a project has a Gemfile depending on rails, a config.ru, or when editing app/models, app/controllers, app/views, config/routes.rb or db/migrate files.
---

# Rails

Assumes Rails 7.1/7.2 or 8.0 (Ruby 3.2+). Rails 7 defaults: Hotwire (Turbo + Stimulus) instead of UJS, import maps or jsbundling, Zeitwerk autoloading, `config.load_defaults 7.x`. Rails 8 adds Solid Queue/Cache/Cable, Propshaft, Kamal and the built-in authentication generator. Check `Gemfile.lock` and `config/application.rb` before assuming features.

## When to use

- Adding or changing models, migrations, controllers, routes, views, jobs, mailers, channels or concerns.
- Fixing N+1 queries or slow ActiveRecord code.
- Writing or fixing RSpec/Minitest tests and system tests.
- Working with Hotwire (Turbo Frames/Streams, Stimulus controllers).
- Not for Sinatra/Hanami or Ruby gems without Rails.

## Project conventions to detect first

1. Rails and Ruby versions: `Gemfile.lock` (`rails (7.2.x)`), `.ruby-version`, `config/application.rb` `load_defaults`. Check `bin/rails --version`.
2. Test framework: `spec/` + `rspec-rails` (+ `factory_bot_rails`, `faker`, `shoulda-matchers`, `capybara`, `webmock`/`vcr`) vs `test/` + Minitest with fixtures. Follow the existing one.
3. Frontend: `importmap-rails` vs `jsbundling-rails` (esbuild/bun) + `cssbundling-rails` (Tailwind) vs Propshaft/Sprockets; `turbo-rails`, `stimulus-rails`; `view_component`, `phlex`; API-only app (`config.api_only = true`).
4. Database: `config/database.yml` adapter (PostgreSQL, MySQL, SQLite), `db/schema.rb` vs `db/structure.sql`, multiple databases, `strong_migrations` gem.
5. Auth: `devise`, Rails 8 `bin/rails generate authentication` (`Session`, `Current.user`), `rodauth`, `omniauth`, `pundit`/`cancancan` for authorization.
6. Background jobs: `solid_queue` (Rails 8 default), `sidekiq`, `good_job`, `delayed_job`; `config.active_job.queue_adapter`.
7. API conventions: `jbuilder`, `active_model_serializers`, `blueprinter`, `graphql-ruby`; versioned namespaces under `app/controllers/api/v1`.
8. Lint/static: `.rubocop.yml` with `rubocop-rails`, `rubocop-rspec`, `rubocop-performance` (Rails 8 ships `rubocop-rails-omakase`); `brakeman`, `bundler-audit`, `erb_lint`.
9. Service layer conventions: `app/services`, `app/forms`, `app/queries`, `app/policies`, concerns in `app/models/concerns`.

## Core guidance

### Models and ActiveRecord

```ruby
class Order < ApplicationRecord
  belongs_to :customer
  has_many :line_items, dependent: :destroy
  has_many :products, through: :line_items

  enum :status, { pending: 0, paid: 1, shipped: 2 }, default: :pending

  validates :total_cents, numericality: { greater_than_or_equal_to: 0 }
  validates :reference, presence: true, uniqueness: true

  scope :recent, -> { order(created_at: :desc) }
  scope :for_customer, ->(customer) { where(customer:) }

  def total = Money.new(total_cents)
end
```

- Validations in the model for invariants; database constraints (`null: false`, unique indexes, foreign keys, check constraints) for guarantees. Both.
- `belongs_to` is required by default (Rails 5+); add `optional: true` deliberately.
- Scopes return relations and chain; class methods for anything needing arguments with logic. Avoid default scopes.
- Callbacks only for the model's own data (normalize, compute). Side effects (emails, jobs, third-party calls) belong in controllers/services or `after_commit` with a job.
- Prefer `normalizes :email, with: ->(e) { e.strip.downcase }` (7.1+), `generates_token_for` (7.1+), `has_secure_password`, `encrypts :ssn` (Active Record Encryption).
- Querying: `where(status: :paid)`, `where.not`, `where("total_cents > ?", 100)` with bind params, `find_by`, `exists?`, `pluck`, `pick`, `find_each`/`in_batches` for large sets, `insert_all`/`upsert_all` for bulk (skips callbacks/validations), `update_all`.
- N+1: `includes` (lets Rails choose), `preload` (separate queries), `eager_load` (JOIN, needed when filtering on the association), `strict_loading` (raises on lazy loads; enable per model or in `config.active_record.strict_loading_by_default` for test env). Use `bullet` in development.

### Migrations

```bash
bin/rails g migration AddStatusToOrders status:integer
bin/rails g model LineItem order:references product:references quantity:integer
bin/rails db:migrate && bin/rails db:rollback STEP=1   # verify reversibility
```

- One concern per migration; `change` with reversible operations, otherwise `up`/`down`.
- Add indexes for FKs and lookup columns (`add_index :orders, [:customer_id, :status]`); `add_reference ..., foreign_key: true` (indexes automatically).
- On PostgreSQL with large tables use `algorithm: :concurrently` + `disable_ddl_transaction!`; adding a `NOT NULL` column: add nullable, backfill in batches, then `change_column_null`. `strong_migrations` enforces this if present.
- Never reference models in migrations for data changes without defining a minimal local class; prefer a rake task or a separate data migration.
- Commit `db/schema.rb` changes with the migration; never hand-edit schema.

### Controllers and routes

```ruby
# config/routes.rb
resources :orders, only: %i[index show new create] do
  resources :line_items, only: %i[create destroy], shallow: true
  member { post :cancel }
end
namespace :api do
  namespace :v1 do
    resources :orders, only: %i[index show], defaults: { format: :json }
  end
end

class OrdersController < ApplicationController
  before_action :set_order, only: %i[show cancel]

  def index
    @orders = Current.user.orders.recent.includes(:customer, line_items: :product).page(params[:page])
  end

  def create
    @order = Current.user.orders.build(order_params)
    if @order.save
      redirect_to @order, notice: "Order created."
    else
      render :new, status: :unprocessable_entity   # required for Turbo to render errors
    end
  end

  private

  def set_order = @order = Current.user.orders.find(params[:id])

  def order_params
    params.require(:order).permit(:reference, line_items_attributes: %i[product_id quantity _destroy])
    # Rails 8: params.expect(order: [:reference, line_items_attributes: [[:product_id, :quantity, :_destroy]]])
  end
end
```

- RESTful resources; custom actions via `member`/`collection` sparingly. Nested resources one level deep.
- Scope queries through the current user/account (`Current.user.orders.find`) instead of `Order.find` + authorization afterthoughts.
- Strong params with `permit`; never `permit!`. Rails 8 `params.expect` raises 400 on wrong shape.
- Respond with `status: :unprocessable_entity` on failed form renders and `status: :see_other` on redirects after `DELETE`, or Turbo will not behave.
- Keep controllers thin: no business logic; call a service/form object or a model method.
- API controllers inherit from `ActionController::API`, use `render json:` (jbuilder or serializer), `rescue_from ActiveRecord::RecordNotFound` -> 404, token auth via `authenticate_or_request_with_http_token`.

### Views and Hotwire

- Layouts in `app/views/layouts`, partials prefixed `_`, rendered with `render @orders` (collection partials) and `render "form", order: @order` (locals, not instance variables).
- Helpers for presentation logic; ViewComponent/Phlex if the project uses them.
- Turbo Drive is on by default: forms need the status codes above; use `data: { turbo: false }` only when necessary.
- Turbo Frames: wrap a region with `turbo_frame_tag dom_id(order)` and respond with a matching frame to replace it in place.
- Turbo Streams: respond `format.turbo_stream` with `turbo_stream.replace/append/remove`; broadcast from models with `broadcasts_to` (requires Action Cable: Solid Cable/Redis).
- Stimulus: `app/javascript/controllers/<name>_controller.js` with `static targets`/`static values`, `data-controller`, `data-action="click->name#method"`. Register via `bin/rails stimulus:manifest:update` with import maps (or the pinned manifest is auto-generated).
- Escape by default; use `sanitize` for user HTML, `raw`/`html_safe` only on trusted strings.

### Jobs, mailers, credentials

- `bin/rails g job ProcessOrder`; `ProcessOrderJob.perform_later(order)` passes GlobalIDs; jobs must be idempotent and small; set `queue_as`, `retry_on`/`discard_on`. Enqueue after commit (`after_commit` or from controllers after `save`); Rails 7.2 defaults `enqueue_after_transaction_commit` for compatible adapters.
- Mailers: `bin/rails g mailer OrderMailer confirmation`; call `OrderMailer.with(order:).confirmation.deliver_later`; preview under `test/mailers/previews` or `spec/mailers/previews` at `/rails/mailers`.
- Credentials: `bin/rails credentials:edit --environment production` (needs `config/credentials/production.key` or `RAILS_MASTER_KEY`); read with `Rails.application.credentials.dig(:stripe, :secret_key)`. Never commit `*.key`. Environment variables are fine too (`ENV.fetch("DATABASE_URL")`).
- Config: `config/environments/*.rb`, custom settings via `Rails.application.config.x.feature` or `config_for(:settings)` + `config/settings.yml`.

### Security basics

- CSRF protection is on for HTML controllers (`protect_from_forgery`); API controllers skip it and use tokens.
- Use `has_secure_password`, strong params, `Current.user`-scoped queries, `rate_limit` (7.2+) on login endpoints, `content_security_policy` initializer.
- Run `bundle exec brakeman -q` and `bundle exec bundler-audit check --update` in CI.

## Common tasks

### Add a resource end to end

1. `bin/rails g model Thing name:string account:references` -> edit migration (indexes, null constraints) -> `bin/rails db:migrate`.
2. Model: associations, validations, scopes. Tests/specs for validations and scopes.
3. `resources :things` in routes; `bin/rails g controller Things index show new create edit update destroy --skip-routes` (or write by hand).
4. Views (index/show/_form) using partials and Turbo-friendly status codes.
5. Request specs or controller tests; system test for the main flow if the project has Capybara.
6. `bundle exec rubocop -a` on changed files.

### Fix an N+1

1. Reproduce with `bullet` or a test using `assert_queries_count`/`expect { }.to make_database_queries(count: n)` (`db-query-matchers`).
2. Add `includes`/`preload` where the collection is loaded (controller or query object), or `strict_loading` on the association to catch regressions.
3. Add the query-count assertion to the test.

### Add a background job

1. `bin/rails g job Name`; implement `perform(record)`; make it idempotent.
2. Enqueue with `perform_later` after commit.
3. Test with `assert_enqueued_with(job: NameJob)` / `have_enqueued_job` (ActiveJob test adapter) and `perform_enqueued_jobs` for integration.

### Write tests

```ruby
# spec/requests/orders_spec.rb
RSpec.describe "Orders", type: :request do
  let(:user) { create(:user) }
  before { sign_in user }   # Devise helper, or the app's own helper

  it "creates an order" do
    expect {
      post orders_path, params: { order: { reference: "A-1" } }
    }.to change(Order, :count).by(1)
    expect(response).to redirect_to(order_path(Order.last))
  end

  it "re-renders on invalid input" do
    post orders_path, params: { order: { reference: "" } }
    expect(response).to have_http_status(:unprocessable_entity)
  end
end
```

Minitest equivalent lives in `test/controllers/orders_controller_test.rb` with fixtures and `assert_difference`. Prefer request specs over controller specs; model specs for logic; system specs (`driven_by :selenium` or `cuprite`) only for key flows.

## Pitfalls

- `Model.find(params[:id])` without scoping to the current user/account (IDOR).
- Missing `status: :unprocessable_entity` / `:see_other` so Turbo silently ignores responses.
- Fat models with callbacks sending emails or calling APIs; failed callbacks rolling back unrelated transactions.
- `default_scope` surprises; `update_attribute`/`update_all`/`insert_all` skipping validations without intent.
- Rendering partials with instance variables instead of locals; `render partial:` in loops instead of `render collection:`.
- Running migrations that lock big tables in production without `strong_migrations`-style precautions.
- Hand-editing `db/schema.rb`, or committing a schema diff from a different database version.
- Zeitwerk naming mismatches: `app/services/order_mailer_service.rb` must define `OrderMailerService`; check with `bin/rails zeitwerk:check`.
- Enqueuing jobs inside a transaction before commit (job runs before the row exists).
- Committing `config/master.key` or `credentials/*.key`.
- Using `ENV["X"]` (nil-tolerant) instead of `ENV.fetch("X")` for required settings.

## Verification

```bash
bin/rails zeitwerk:check
bin/rails db:migrate && git status db/schema.rb      # schema change expected and committed
bin/rails db:migrate:status
bundle exec rspec                 # or: bin/rails test  (and bin/rails test:system)
bundle exec rubocop
bundle exec brakeman -q --no-pager
bundle exec bundler-audit check --update
bin/rails routes -g orders        # confirm routes
bin/dev                           # Procfile.dev: server + js/css watchers
```

## References

- [references/activerecord-queries.md](references/activerecord-queries.md): association loading strategies, query-object pattern, batching and locking.
- Rails Guides: https://guides.rubyonrails.org/
- Active Record Query Interface: https://guides.rubyonrails.org/active_record_querying.html
- Hotwire: https://turbo.hotwired.dev/handbook/introduction and https://stimulus.hotwired.dev/handbook/introduction
- rubocop-rails: https://docs.rubocop.org/rubocop-rails/
- RSpec Rails: https://rspec.info/features/6-0/rspec-rails/
