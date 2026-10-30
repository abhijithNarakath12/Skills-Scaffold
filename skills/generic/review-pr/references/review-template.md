# Review: <PR title or change summary>

**Target:** PR #123 / branch `feature/x` vs `main` / working tree
**Intent:** <one sentence: what the change claims to do>
**Verdict:** ✅ Approve | ✅ Approve with minor changes | ❌ Request changes

<One paragraph: overall assessment, the most important finding, and what makes the verdict.>

## Verification performed

- `npm test` → 142 passed (ran locally)
- `npm run lint` → clean
- Manual: <what was exercised>
- Not run: <what could not be verified and why>

## Findings

### Blockers
1. **`src/api/orders.ts:88`** – Refund amount is not validated against the captured amount; a request with `amount > captured` succeeds and over-refunds.
   *Scenario:* POST /refund with amount 200 on a 100 order.
   *Fix:* compare to `order.capturedAmount` before calling the gateway; add a test in `orders.test.ts`.

### Major
1. **`src/jobs/sync.ts:41-57`** – ...

### Minor
1. ...

### Nits
- `src/util/date.ts:12` – prefer the existing `formatISO` helper.

## Outside this change (pre-existing, not blocking)
- `src/legacy/import.ts` swallows errors; worth a follow-up issue.

## What is good
- Clear separation of validation from persistence in `OrderService`.
- Tests cover the happy path and the duplicate-order case.

## Suggested follow-ups
- ...
