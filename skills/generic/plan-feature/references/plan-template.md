# Plan: <feature or change name>

- **Status:** Draft | Approved | In progress | Done
- **Date:** YYYY-MM-DD
- **Author:** <agent> for <user>
- **Design document:** <link to docs/design/... if one exists, otherwise "none">
- **Related:** <issue / ticket / PR links>

## Goal

One or two sentences: what will be true when this is done, from the user's point of view.

## Scope

### In scope
- ...

### Non-goals
- Things that are deliberately *not* part of this change, so nobody expects them.

## Context and findings

What you learned from reading the code that shapes the plan: existing modules to reuse, patterns to follow, constraints (versions, CI, style), relevant tests.

- `path/to/file.ts` – does X, will be extended.
- Existing pattern: ...

## Approach

Short description of the chosen approach and why. If alternatives were considered:

| Option | Pros | Cons | Decision |
|---|---|---|---|
| A (chosen) | | | ✅ |
| B | | | ❌ because ... |

## Steps

Each step: what, where (files), and how it is verified. Keep steps small enough to review individually.

- [ ] **1. <step title>**
  - Files: `src/...`, `tests/...`
  - Change: ...
  - Verify: `npm test -- limits` passes; or manual: call `X`, expect `Y`.
- [ ] **2. <step title>**
  - Files:
  - Change:
  - Verify:
- [ ] **3. Tests and docs**
  - Files:
  - Verify:

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ... | low/med/high | low/med/high | ... |

## Open questions

- Questions whose answer would change the plan. If none, write "None".

## Assumptions

- Assumptions made to proceed without blocking. If none, write "None".

## Estimated size

S / M / L, and a sentence on what drives it.

---

## Deviations (filled during implementation)

- YYYY-MM-DD: ...

## Result (filled when done)

- What was built:
- How it was verified:
- Follow-ups:
