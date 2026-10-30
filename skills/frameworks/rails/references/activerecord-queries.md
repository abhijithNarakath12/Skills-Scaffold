# ActiveRecord query patterns

## Loading associations

| Method | SQL | Use when |
|---|---|---|
| `includes(:a)` | preload or eager_load (Rails decides; JOIN if you `references`/`where` on it) | default choice |
| `preload(:a)` | separate `SELECT ... WHERE id IN (...)` | large associations, no filtering on them |
| `eager_load(:a)` | `LEFT OUTER JOIN` | filtering/ordering by association columns |
| `joins(:a)` | `INNER JOIN`, no loading | filter only; combine with `includes` if you also need records |
| `left_joins(:a)` | `LEFT OUTER JOIN`, no loading | counts of optional associations |

Nested: `includes(line_items: :product)`, `includes(:customer, line_items: [:product, :discounts])`.

Filtered preload: `preload(:line_items)` cannot filter; use a scoped association instead:

```ruby
has_many :active_line_items, -> { where(active: true) }, class_name: "LineItem"
Order.includes(:active_line_items)
```

Counts without N+1: `Order.left_joins(:line_items).group(:id).select("orders.*, COUNT(line_items.id) AS line_items_count")` or a `counter_cache: true` column.

## Strict loading

```ruby
class Order < ApplicationRecord
  has_many :line_items, strict_loading: true
end
Order.strict_loading.first.line_items       # raises ActiveRecord::StrictLoadingViolationError
config.active_record.strict_loading_by_default = true   # in config/environments/test.rb to catch N+1 in tests
config.active_record.action_on_strict_loading_violation = :log  # :raise (default) or :log
```

## Query objects

```ruby
# app/queries/orders/search_query.rb
module Orders
  class SearchQuery
    def initialize(relation = Order.all) = @relation = relation

    def call(status: nil, customer_id: nil, q: nil)
      scope = @relation
      scope = scope.where(status:) if status
      scope = scope.where(customer_id:) if customer_id
      scope = scope.where("reference ILIKE ?", "%#{Order.sanitize_sql_like(q)}%") if q.present?
      scope.includes(:customer).recent
    end
  end
end
```

Always sanitize user input in `LIKE` patterns (`sanitize_sql_like`) and use bind parameters (`?` or named `:param`).

## Aggregates, subqueries, window functions

```ruby
Order.group(:status).count                                  # { "paid" => 10, ... }
Order.where(customer_id: Customer.where(vip: true).select(:id))   # subquery, no array round trip
Order.select("orders.*, RANK() OVER (PARTITION BY customer_id ORDER BY created_at DESC) AS rnk")
Order.sum(:total_cents); Order.average(:total_cents); Order.maximum(:created_at)
Order.where(created_at: 1.week.ago..)                       # endless range
Order.where.missing(:line_items)                             # 6.1+: no associated rows
Order.where.associated(:customer)                            # 7.0+
Order.order(Arel.sql("CASE WHEN status = 1 THEN 0 ELSE 1 END")) # Arel.sql only for trusted strings
```

Arel sanity: `Order.arel_table[:total_cents].gt(100)` when you need composable conditions; `or` with `Order.paid.or(Order.shipped)`.

## Batching and bulk

```ruby
Order.find_each(batch_size: 1000) { |o| ... }       # ordered by PK, memory-safe
Order.in_batches(of: 5000).update_all(archived: true)
Order.insert_all([{ reference: "A" }, { reference: "B" }], unique_by: :reference)   # no validations/callbacks
Order.upsert_all(rows, unique_by: :reference, update_only: %i[total_cents])         # 7.0+ update_only
Order.where(id: ids).update_all(status: :shipped)   # skips validations, callbacks, updated_at
Order.where(id: ids).touch_all                      # update updated_at only
```

`insert_all`/`upsert_all` accept `returning: %i[id]` on PostgreSQL; check `ActiveRecord::Persistence::ClassMethods` docs for adapter support.

## Transactions and locking

```ruby
Order.transaction do
  order.lock!                       # SELECT ... FOR UPDATE
  order.update!(status: :paid)
  Ledger.create!(order:, amount: order.total_cents)
end
order.with_lock { order.decrement!(:stock) }        # reload + lock + yield in transaction
# Optimistic: add integer column lock_version; stale updates raise ActiveRecord::StaleObjectError
```

- Use bang methods (`save!`, `update!`, `create!`) inside transactions so failures roll back.
- `after_commit` / `after_save_commit` for side effects; `after_rollback` rarely.
- Nested `transaction` blocks join the outer one; use `requires_new: true` for savepoints.
- Rails 7.2+: `ActiveRecord.after_all_transactions_commit { ... }` and `transaction.after_commit` for code that may run inside or outside a transaction.

## Performance checklist

- `EXPLAIN`: `Order.where(...).explain` (7.1+: `.explain(:analyze)` on PostgreSQL).
- Add indexes for every `where`/`order`/`join` column combination used by hot queries; partial indexes with `where:` option.
- `select` only needed columns for wide tables (`select(:id, :reference)`), or `pluck`.
- `size` vs `count` vs `length`: `size` uses loaded data if present, else COUNT; `count` always queries; `length` loads everything.
- `exists?` instead of `any?`/`present?` on unloaded relations.
- `Rails.cache.fetch("key/#{obj.cache_key_with_version}") { ... }` for expensive derived data; `cache_key_with_version` includes `updated_at`.
- Log slow queries: `config.active_record.verbose_query_logs = true` in development shows the calling line; `ActiveRecord::QueryLogs` adds SQL comments with controller/action tags.
