---
name: pandas
description: Work with tabular data in pandas 2.x - loading (read_csv/parquet/sql), selection with loc/iloc and boolean masks, vectorized operations instead of apply, groupby/agg/transform, merge/join/concat, missing data, dtypes including the Arrow backend and categoricals, memory and performance, plotting hand-off, and pitfalls such as SettingWithCopyWarning and chained assignment under copy-on-write. Load when a Python project depends on pandas or when writing data loading, cleaning, aggregation or analysis code with DataFrames.
---

# pandas 2.x

Assumes pandas 2.x (2.1+) on Python 3.10+, optionally with `pyarrow` installed. pandas 3.0 makes copy-on-write (CoW) the only mode and changes the default string dtype; the guidance below is written to be correct under CoW so code keeps working.

## When to use

- Loading, cleaning, reshaping, joining or aggregating tabular data in scripts, notebooks, ETL jobs, or tests.
- Fixing `SettingWithCopyWarning`, slow `apply` loops, dtype surprises (`object` columns), or memory problems.
- Preparing data for plotting, modelling (scikit-learn), or export (CSV/Parquet/SQL/Excel).
- For very large data (does not fit in memory) consider Polars, DuckDB or Dask instead; say so rather than forcing pandas.

## Project conventions to detect first

1. Version pins in `pyproject.toml`/`requirements*.txt`; presence of `pyarrow` (enables `dtype_backend='pyarrow'`, Parquet, fast CSV engine), `numpy` version (2.x changes some scalar reprs), `openpyxl`/`xlsxwriter` for Excel, `sqlalchemy` for `read_sql`.
2. Options set globally: `pd.options.mode.copy_on_write = True` (or `"warn"`), `pd.set_option('future.infer_string', True)`, display options. If CoW is enabled, chained-assignment patterns are silently no-ops; write code accordingly.
3. Style: method chaining with `.pipe()`/`.assign()` vs step-by-step reassignment; `df.query()` usage; `inplace=True` (discouraged) usage.
4. Typing/validation: `pandera` schemas, `pandas-stubs` for mypy, type hints `pd.DataFrame`.
5. I/O layout: data folder conventions, Parquet vs CSV, `read_csv` dtype dictionaries, date parsing helpers.
6. Tests: `pandas.testing.assert_frame_equal` usage, fixture DataFrames, `pytest` marks for slow data tests.
7. Notebooks: `.ipynb` with exploratory code vs library modules; move reusable logic to modules.

## Core guidance

### Loading data

```python
import pandas as pd

df = pd.read_csv(
    "data/orders.csv",
    dtype={"order_id": "int64", "sku": "string", "country": "category"},
    parse_dates=["ordered_at"],
    usecols=["order_id", "sku", "country", "ordered_at", "amount"],
    dtype_backend="pyarrow",          # optional: Arrow-backed dtypes, nullable everywhere
)
df = pd.read_parquet("data/orders.parquet", columns=[...])                 # preferred interchange format
df = pd.read_sql("SELECT ... WHERE ordered_at >= %(since)s", engine, params={"since": since}, parse_dates=["ordered_at"])
```

- Specify `dtype`, `usecols`, `parse_dates` up front; it is faster and avoids `object` columns. `pd.to_datetime(col, format="%Y-%m-%d", utc=True)` with an explicit format is far faster than inference and avoids mixed-format warnings.
- Big CSVs: `chunksize=` to iterate, or `engine="pyarrow"`. Prefer Parquet for anything read repeatedly.
- `read_excel` needs `openpyxl`; `sheet_name=None` reads all sheets into a dict.
- Validate shape/dtypes right after load (`df.dtypes`, `df.shape`, `df.isna().sum()`), or with a pandera schema in pipelines.

### Selection and assignment

```python
df.loc[df["amount"] > 100, ["order_id", "amount"]]        # label-based rows (mask) and columns
df.iloc[:5, 0:2]                                          # position-based
df[df["country"].isin(["DE", "FR"]) & df["amount"].between(10, 50)]
df.query("country == 'DE' and amount > @threshold")
df.loc[df["amount"] < 0, "amount"] = 0                   # single-step assignment: no SettingWithCopy issue
df = df.assign(amount_eur=lambda d: d["amount"] * rate, year=lambda d: d["ordered_at"].dt.year)
```

- Use `loc`/`iloc` for anything beyond pulling a column; `df[...]` is for column selection or boolean row masks only.
- Chained indexing `df[mask]["col"] = x` never reliably writes; under CoW it never writes. Always `df.loc[mask, "col"] = x`.
- Under CoW any derived DataFrame/Series is logically a copy; to modify the original, index into the original. Call `.copy()` explicitly when you intend an independent object in non-CoW mode.
- Combine conditions with `&`, `|`, `~` and parentheses; `and`/`or` raise.
- Set a meaningful index only when you need alignment or fast label lookups (`set_index("order_id")`); `reset_index()` before writing out. Avoid `MultiIndex` unless the data is genuinely hierarchical.

### Vectorized operations vs apply

- Column arithmetic, comparisons, `np.where`/`np.select`, `.str` accessor (`df["sku"].str.upper()`, `.str.extract(r"(\d+)")`), `.dt` accessor, `pd.cut`/`pd.qcut`, `Series.map(dict)`, `Series.where/mask`, `clip`, `rank`, `cumsum`, `diff`, `shift`, `rolling(...).mean()` are vectorized.
- `df.apply(f, axis=1)` is a Python loop over rows: 100x slower. Use it only for genuinely row-wise logic that cannot be expressed otherwise; even then consider `np.vectorize`, `itertuples()`, or `numba`.
- `Series.map`/`apply` with a Python function is acceptable for small data or string parsing that `.str` cannot do.
- Conditional columns: `np.select([cond1, cond2], ["a", "b"], default="c")`.
- Avoid growing a DataFrame in a loop (`pd.concat` per iteration or `df.loc[len(df)] = row`); collect records in a list and build once.

### GroupBy

```python
summary = (
    df.groupby(["country", "year"], observed=True, as_index=False)
      .agg(orders=("order_id", "count"), revenue=("amount", "sum"), avg=("amount", "mean"))
)
df["country_share"] = df["amount"] / df.groupby("country")["amount"].transform("sum")   # same shape as df
top = df.sort_values("amount", ascending=False).groupby("country").head(3)
```

- Named aggregation (`new=("col", "func")`) gives clean column names; `agg({"col": ["sum", "mean"]})` yields a MultiIndex header.
- `transform` returns aligned results (ratios, z-scores, fills); `agg` reduces; `filter` keeps whole groups; `apply` is slow and ambiguous (deprecated behaviour around including grouping columns).
- `observed=True` with categoricals (default from pandas 3.0; silence the FutureWarning now). `dropna=False` to keep NaN groups. `sort=False` when order does not matter (faster).
- Time buckets: `df.resample("W", on="ordered_at")["amount"].sum()` or `pd.Grouper(key="ordered_at", freq="MS")`. Offset aliases changed: use `"ME"`/`"YE"`/`"h"`/`"min"` (2.2+) instead of `"M"`/`"Y"`/`"H"`/`"T"`.

### Combining data

```python
merged = orders.merge(customers, on="customer_id", how="left", validate="many_to_one", indicator=True)
assert (merged["_merge"] == "both").all()
stacked = pd.concat([df_2023, df_2024], ignore_index=True)
wide = long.pivot_table(index="country", columns="year", values="amount", aggfunc="sum", fill_value=0)
long = wide.reset_index().melt(id_vars="country", var_name="year", value_name="amount")
```

- Always pass `how` and `validate`; `validate="one_to_one"`/`"many_to_one"` catches duplicate-key explosions. `indicator=True` to audit unmatched rows.
- `join` is `merge` on indexes; `concat` stacks (axis=0) or aligns side by side (axis=1, by index). Ensure keys share dtypes (`int64` vs `string` keys silently match nothing).
- `merge_asof` for nearest-time joins (prices, sensor readings), sorted inputs required.

### Missing data and dtypes

- Nullable dtypes: `"Int64"`, `"boolean"`, `"string"`, `"Float64"` (capitalised) or Arrow dtypes (`"int64[pyarrow]"`, `"string[pyarrow]"`) use `pd.NA` and keep integers integer when NaN appears. The default numpy `int64` column becomes `float64` once a NaN is introduced.
- `df.convert_dtypes()` upgrades to nullable dtypes; `df.astype({"col": "category"})` for low-cardinality strings (memory and groupby speed).
- Fill: `fillna(value)`, `fillna({"col": 0})`, `ffill()`/`bfill()` (the `method=` argument is deprecated); drop: `dropna(subset=[...])`; `isna()`/`notna()` (never `== np.nan`).
- `pd.NA` in boolean context raises; use `.fillna(False)` before `if`/indexing, or `Series.eq(x).fillna(False)`.
- Strings: with `pd.options.future.infer_string = True` (default in 3.0) text columns are `str` dtype backed by Arrow when available; `.str` methods work the same. Missing is `NaN` in the default string dtype in 3.0 (not `pd.NA`).
- Dates: keep tz-aware UTC (`utc=True`) and convert at the edge (`dt.tz_convert("Europe/Berlin")`). Period/offset math via `pd.DateOffset`, `pd.Timedelta`.
- Downcast numerics `pd.to_numeric(col, downcast="integer")` and check `df.memory_usage(deep=True)` to size memory.

### Performance and memory

1. Load only needed columns/rows; set dtypes at load; use Parquet.
2. Vectorize; eliminate `iterrows`/`apply(axis=1)`.
3. Categoricals for repeated strings; nullable/Arrow dtypes for strings and ints.
4. `df.eval`/`df.query` with `engine="numexpr"` for large arithmetic expressions (optional dependency).
5. Profile with `%timeit`, `df.info(memory_usage="deep")`, `line_profiler`; measure before optimising.
6. Beyond memory: DuckDB (`duckdb.sql("...").df()`), Polars (`pl.from_pandas`), Dask, or chunked processing.

### Plotting hand-off

- Quick looks: `df.plot(kind="line", x="ordered_at", y="amount")` (matplotlib backend) or `pd.options.plotting.backend = "plotly"`.
- For production charts, aggregate in pandas to a tidy frame (one row per mark, explicit column names) and pass it to matplotlib/seaborn/plotly/Altair; do not do data wrangling inside plotting code.

### Testing

```python
import pandas as pd
from pandas.testing import assert_frame_equal

def test_summary():
    df = pd.DataFrame({"country": ["DE", "DE", "FR"], "amount": [1.0, 2.0, 5.0]})
    out = summarise(df)
    expected = pd.DataFrame({"country": ["DE", "FR"], "revenue": [3.0, 5.0]})
    assert_frame_equal(out.reset_index(drop=True), expected, check_dtype=False)
```

Use small literal frames, `assert_frame_equal`/`assert_series_equal` (with `check_like=True` to ignore column order, `check_exact=False`/`rtol` for floats), and `pandera` schemas for structural contracts on pipeline boundaries.

## Common tasks

### Clean a raw CSV into a typed table

1. `read_csv` with `dtype`, `usecols`, `na_values`; `to_datetime` with `format`.
2. Normalise strings (`.str.strip().str.lower()`), map codes with `Series.map`, cast categoricals.
3. Validate (`assert df["id"].is_unique`, pandera), write Parquet.

### Add a derived column safely

`df = df.assign(new=...)` or `df.loc[:, "new"] = ...` on the frame you own; if `df` came from filtering another frame and you are not under CoW, `.copy()` first.

### Compute per-group metrics and join back

`df["grp_mean"] = df.groupby("key")["x"].transform("mean")` (no merge needed); for multiple aggregates use `agg` then `merge(..., on="key", how="left", validate="many_to_one")`.

### Reshape wide <-> long

`melt` (wide to long), `pivot`/`pivot_table` (long to wide), `stack`/`unstack` for MultiIndex; `explode` for list cells; `pd.json_normalize` for nested JSON.

### Write results

`df.to_parquet(path, index=False)`, `df.to_csv(path, index=False)`, `df.to_sql("table", engine, if_exists="append", index=False, method="multi", chunksize=1000)`, `df.to_excel(writer, sheet_name=...)` with `pd.ExcelWriter(path, engine="xlsxwriter")`.

## Pitfalls

- `SettingWithCopyWarning`: caused by chained indexing or modifying a filtered frame; fix with `.loc[mask, col] = ...` on the original, or `.copy()` the subset. Under CoW the warning disappears but chained assignment silently does nothing, so the fix is the same.
- `inplace=True` does not save memory and breaks chaining; reassign instead.
- Integer columns turning into floats after `reindex`/merge/NaN; use `"Int64"`.
- Comparing to `np.nan` with `==`; use `isna()`.
- `df.append` (removed in 2.0); use `pd.concat`.
- `groupby(...).apply` including the grouping columns (behaviour changed; `include_groups=False` or use `agg/transform`).
- Deprecated offset aliases (`"M"`, `"H"`), `fillna(method=...)`, `DataFrame.swapaxes`, `Series.view`, implicit downcasting in `where/fillna` (set `pd.set_option("future.no_silent_downcasting", True)`).
- Sorting by default in `groupby`/`merge` changing row order you relied on; sort explicitly.
- `object` dtype columns hiding mixed types (`"1"` and `1`); check `df["col"].map(type).value_counts()`.
- Timezone-naive vs aware comparisons raising `TypeError`.
- Reading dates without `format`, triggering per-element inference and silent day/month swaps.
- Float equality in tests; use `check_exact=False`/`np.isclose`.

## Verification

```bash
pytest -q                     # unit tests with assert_frame_equal
python -W error::FutureWarning -c "import your_module"   # surface deprecations early (or set in pytest filterwarnings)
mypy . (with pandas-stubs) | ruff check .
```

In notebooks/scripts, check `df.dtypes`, `df.shape`, `df.isna().sum()` and `df.memory_usage(deep=True).sum()` after each major transformation.

## References

- pandas user guide: https://pandas.pydata.org/docs/user_guide/index.html
- Copy-on-Write: https://pandas.pydata.org/docs/user_guide/copy_on_write.html
- Indexing and SettingWithCopy: https://pandas.pydata.org/docs/user_guide/indexing.html
- PyArrow functionality: https://pandas.pydata.org/docs/user_guide/pyarrow.html
- Scaling to large datasets: https://pandas.pydata.org/docs/user_guide/scale.html
- What's new (2.x, 3.0): https://pandas.pydata.org/docs/whatsnew/index.html
