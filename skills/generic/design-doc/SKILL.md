---
name: design-doc
description: Write a design document before implementing a feature, and implement only after the document is approved. The document analyses requirements against the existing codebase and records every data structure the feature uses (fields, types, where defined, invariants, persistence), interfaces and APIs, algorithms with time and space complexity, data flow, error handling, testing and rollout. Use when asked for a design doc, tech spec, RFC, or architecture proposal, when invoked with /design, and for any feature that introduces or changes data models, schemas, APIs, or cross-module behaviour.
---

# Design document before implementation

A design document is the single place where a reader can learn, without reading code, **what data a feature uses, how it flows, how expensive it is, and why it was built this way.** This skill produces that document, gets it approved, and then keeps it truthful while the feature is implemented.

Contract: **no implementation until the design document is approved.**

## When to use

- The user invokes `/design <feature>`.
- The user asks for a design document, tech spec, RFC, architecture proposal, or "how would you build X".
- A feature adds or changes data structures, database schemas, message formats, public APIs, or background jobs.
- The work spans several modules or services, or has non-obvious performance, security or migration implications.
- The user wants to understand data structures and complexity before committing to an approach.

Not needed for small, local changes. For those, the `plan-feature` skill alone is enough. When both apply: design document first (the *what and why*), then a plan (the *how and in what order*), then implementation.

## Workflow

### 1. Gather requirements

1. Restate the feature in your own words: who needs it, what they can do afterwards, what success looks like.
2. Extract explicit requirements from the request and any linked issues, tickets or chat history. Number them (`R1`, `R2`, ...) so the design can reference them.
3. Derive non-functional requirements that the user did not say but will care about: expected data volume and request rate, latency, consistency, security and privacy, compatibility, observability.
4. If a requirement is ambiguous and the ambiguity changes the design, ask at most three precise questions before drafting. Otherwise record an assumption in the document and move on.

### 2. Analyse the codebase

Before designing, read the code the feature will touch. Record what you find; the document must be grounded in the real system, not an imagined one.

- Entry points and modules involved (routes, handlers, services, jobs, UI components).
- **Existing data structures** that the feature reads or writes: types, classes, tables, documents, message schemas, config. Note file paths and current fields.
- Existing conventions: validation, error handling, logging, transactions, DI, testing style, naming, folder layout.
- Related features that already solve a similar problem; prefer extending them over inventing parallels.
- Current performance characteristics or limits that matter (indexes, pagination, caching, rate limits).

### 3. Write the document

Create `docs/design/YYYY-MM-DD-<short-slug>.md` (or the project's existing design/RFC directory) using [references/design-doc-template.md](references/design-doc-template.md). Fill every section; write "None" or "Not applicable" rather than leaving headings empty.

The sections that matter most, and what "done" looks like for each:

**Data model.** This is the heart of the document. Catalogue **every** data structure the feature touches, new or existing, following [references/data-structure-catalog.md](references/data-structure-catalog.md). For each one: name, kind (class / interface / table / document / enum / message / cache entry), where it is defined (file path or schema), every field with type, nullability and meaning, invariants, how it is persisted or transported, lifecycle (who creates, mutates, deletes it), size expectations, and whether it is new, changed, or only read. Include schema migrations as explicit DDL or migration steps. A reader must be able to answer "what data structure holds X and where is it defined?" from this section alone.

**Interfaces and APIs.** Exact signatures: function signatures for internal APIs; method, path, request and response bodies, status codes and error shapes for HTTP; topics and payloads for events. State backward-compatibility impact.

**Algorithms and complexity.** For each non-trivial operation: the algorithm in a few lines or pseudocode, time complexity and space complexity in big-O with the variable defined (n = number of items in ..., m = ...), expected real-world sizes, and the hot path. Call out anything that is O(n²) or worse, anything that does N+1 queries, and any unbounded memory growth. State the complexity of database queries in terms of indexes used.

**Data flow.** A sequence of steps (or a Mermaid sequence diagram) from trigger to result, naming the components and the data structures passed at each hop. Include the failure paths.

**Alternatives considered.** At least one real alternative with a reason it lost. "No alternatives" is almost never true.

**Testing strategy.** Which behaviours are tested at which level (unit, integration, end-to-end), the fixtures or data needed, and performance tests if complexity is a concern.

**Rollout and migration.** Feature flags, backfills, ordering of deploys, rollback plan, and what happens to data created during a partial rollout.

Keep the document precise rather than long. Tables beat prose for fields and complexity. Diagrams (Mermaid) are welcome where they replace paragraphs.

### 4. Present and stop for approval

Summarize the document in chat: the approach in three sentences, the list of data structures (new / changed), the main trade-offs and the open questions. Then ask explicitly:

> Design document written to `docs/design/2025-01-15-search-indexing.md`. Please review. Do you approve this design, want changes, or prefer one of the alternatives? I will not implement anything until the design is approved.

Then **stop**. Only read-only actions are allowed while waiting (reading code, running existing tests). Do not scaffold files "to save time".

Handle replies:

- **Change requests or questions:** update the document (keep a short "Revision history" table), summarise what changed, ask again.
- **Partial approval** ("the data model is fine but revisit the API"): revise only that section, mark the rest as approved, ask again.
- **Approval** ("approved", "LGTM", "go ahead", "implement it"): set `Status: Approved`, record the date, and continue to step 5.
- **Silence or ambiguity:** ask again; never treat it as approval.

### 5. Plan and implement

1. If the `plan-feature` skill is available, derive an implementation plan from the approved design and get it approved too (this is usually quick because the design settles the hard questions). Otherwise, list the implementation steps in the document's "Implementation plan" section and proceed.
2. Implement. Follow the data model and interfaces exactly as approved. If implementation reveals that something in the design is wrong or impractical:
   - stop before diverging if the change affects data structures, interfaces, complexity or scope, explain the issue, propose the change, and ask for approval of the amendment;
   - for small deviations (naming, internal helper structure), proceed and record them under "Implementation notes".
3. Keep the document alive: after implementation, update the "Implementation notes" section with the final file locations for every data structure and interface, the actual measured performance if measured, and anything that differs from the approved design. Set `Status: Implemented`.

## Rules

- **Every data structure is documented**, including existing ones the feature merely reads. Partial catalogues are the most common way these documents go stale.
- **Complexity is stated with variables defined.** "Fast" and "efficient" are not complexities.
- **Ground claims in code.** Cite file paths for existing structures and behaviours. Do not describe a system you have not read.
- **Separate decisions from options.** The chosen design is described in full; alternatives get a short comparison table.
- **Approval is explicit and recorded** in the document's status line, with the date.
- **Do not implement during the review loop.** Reviewers must be able to trust that nothing has changed on disk until they say so.
- **Keep it readable** for someone joining the project later: define domain terms in the glossary, expand acronyms once.

## Quick reference

| Situation | Action |
|---|---|
| Feature touches only one function, no data changes | Skip the design doc; use `plan-feature` |
| Requirements unclear and blocking | Ask up to three questions, then draft with assumptions |
| User approves but later changes a requirement | Add a revision, update affected sections, re-confirm only those |
| Implementation reveals a flaw in the design | Stop, explain, propose amendment, wait for approval |
| Done implementing | Fill Implementation notes, set Status: Implemented |
