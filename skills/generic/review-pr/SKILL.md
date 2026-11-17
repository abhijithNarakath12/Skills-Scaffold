---
name: review-pr
description: Review a pull request, branch, commit range or working-tree diff for correctness, security, performance, tests, API compatibility and readability, and produce a structured review with severity-ranked findings tied to file and line, concrete fix suggestions, and a clear verdict. Use when asked to review code, a PR, a diff, a branch, or to check changes before merging.
---

# Code and pull request review

A review is useful when it finds real defects, says exactly where they are, and tells the author what to do. This skill produces that kind of review: evidence-based, ranked by severity, and free of noise.

## Two operating modes

| Mode | Context required | What it can verify |
|---|---|---|
| **Full review** | Codebase indexed or available locally | Callers and callees, full file context, test execution, build |
| **Architecture-first review** | `docs/design/project-design.md` only | Every project guideline against the diff; cannot trace callers or run tests |

**Architecture-first review** is the correct mode for a fresh session, a cross-team review, or any situation where the full codebase is unavailable. The project design produced by `/design project` is the sole architectural source of truth; every numbered guideline (G1, G2, ...) must be checked against the diff even without code context. The reviewer must state explicitly which checks could not be performed.

## When to use

- "Review this PR / branch / diff / my changes."
- "Is this safe to merge?" / "Check this before I open a PR."
- A `plan-feature` or `design-doc` workflow has finished implementing and the result should be checked.

## Workflow

### 1. Collect the change and its intent

1. **Load the project design first — always.** Before obtaining the diff or reading any code, read `docs/design/project-design.md`. Extract and list every numbered guideline (`G1`, `G2`, ...) — this list drives the architecture conformance section of the review output. Also read any feature design or plan document relevant to this change (`docs/plans/`, `docs/design/`). Record which guidelines apply.

   - If no project design exists, note this and proceed without architecture conformance checks.
   - Violations of approved project guidelines are findings: **Major** by default, **Blocker** when they break data ownership, security, or an architectural boundary. Always cite the guideline id.

   > **Architecture-first mode (fresh session / no code context):** The project design and the diff alone are sufficient to perform a complete architectural review. Load the project design as above, then follow steps 2–4 and proceed to step 2 (Read, do not skim) only for the diff itself — not the full codebase. Explicitly note in the review which checks were skipped (full-file context, callers/callees, test execution) and why.

2. Identify the target. In order of preference:
   - a PR number or URL: `gh pr view <n> --json title,body,baseRefName,headRefName,files,commits` and `gh pr diff <n>`;
   - a branch: `git diff <base>...<branch>` (use the merge base; default base is the repository's main branch);
   - a commit range: `git diff <a>..<b>`;
   - the working tree: `git diff` plus `git diff --cached`, and `git status` for untracked files.
3. Read the PR title, description, linked issues, and commit messages. Write down, in one sentence, what the change claims to do. Everything else in the review is judged against that claim.
4. List the changed files grouped by role: production code, tests, config and infra, docs, generated files. Generated files and lockfiles are skimmed, not reviewed line by line.

### 2. Read, do not skim

- Read each changed file **in full**, not only the diff hunks. Context above and below a hunk is where most bugs hide (an early return, a lock, a null check that no longer holds).
- Follow every new or changed function to its callers and callees. Ask: did all call sites get updated? Does any caller rely on the old behaviour?
- For deleted code, check nothing else still references it (grep).
- For each new dependency, check it is actually needed, maintained, licensed compatibly, and pinned the way the project pins things.
- Run what you can: the test suite, linters, type checks, the build. A review that says "tests pass" must have run them. If you cannot run something, say so.

### 3. Evaluate against the checklist

Work through [references/review-checklist.md](references/review-checklist.md). It covers correctness, edge cases, error handling, concurrency, security, performance, data and migrations, API compatibility, tests, readability, and operations. Do not report checklist items that are fine; it is a tool for looking, not a form to fill.

Each potential finding must pass this test before it is reported:

1. **Is it real?** You can point at the line and describe the input or state that triggers the problem. "This might be an issue" without a scenario is not a finding; verify it or drop it.
2. **Does it matter?** It affects correctness, security, data, performance at realistic scale, maintainability, or the stated intent.
3. **Is it in scope?** Pre-existing problems in untouched code are mentioned once in a separate "Outside this change" note, not as findings against the author.

### 4. Write the review

Use [references/review-template.md](references/review-template.md). Severity levels:

| Level | Meaning | Merge? |
|---|---|---|
| **Blocker** | Wrong behaviour, data loss, security hole, broken build or tests, violates approved design | No |
| **Major** | Likely bug under realistic conditions, missing tests for risky logic, performance problem at expected scale, breaking API change without migration | Not until addressed or explicitly accepted |
| **Minor** | Edge case, unclear error handling, maintainability debt, misleading naming | Can merge, should fix soon |
| **Nit** | Style, wording, micro-cleanups | Optional |

**If a project design was loaded in step 1.1**, include a **Project design conformance** section before all other findings. For every extracted guideline, fill one row in the conformance table with: guideline id, its one-sentence rule, compliance status (✅ Compliant / ❌ Violated / — Not applicable), and evidence (`path:line` from the diff, or "not touched by this change"). A `❌ Violated` row becomes a finding at the severity described above. This table must be complete — every guideline has a row even if the diff does not touch that area.

For every finding give: severity, `path:line`, what is wrong, the concrete scenario that triggers it, and a suggested fix (code when short). Group findings by file, blockers first within the summary.

Finish with a verdict: **Approve**, **Approve with minor changes**, or **Request changes**, and one paragraph explaining why. Also list what is good about the change; authors need to know what to keep doing, and reviewers calibrate better when they must name strengths.

### 5. Deliver

- Print the review in chat.
- If asked to post it, use `gh pr review <n> --comment --body-file <file>` (or `--request-changes` / `--approve` matching the verdict), and inline comments via `gh api` for findings with exact lines. Never approve on the author's behalf without being asked to.
- If asked to fix the findings, do so in order of severity, run the tests again, and summarise what changed.

## Rules

- **Evidence over opinion.** Cite lines. Reproduce bugs when practical (a failing test is the best finding).
- **No style policing when tooling exists.** If a formatter or linter is configured, do not report what it would catch; run it instead and report only if it fails.
- **Respect the project's conventions** over your own preferences. Consistency with the surrounding code beats the "better" pattern.
- **Be specific and kind.** "This leaks the connection when `parse` throws (line 42); wrap in try/finally" beats "error handling needs work".
- **Do not invent requirements.** Review against the stated intent and the approved design, not against features nobody asked for.
- **Call out missing tests precisely:** which behaviour, which input, where the test should live.
- **Keep it proportionate.** A 10-line PR gets a short review. Do not pad with nits to look thorough.

## Quick reference

| Situation | Action |
|---|---|
| Fresh session / no code context | Architecture-first mode: load `docs/design/project-design.md`, get the diff, check every guideline; note which checks were skipped |
| No project design exists | Skip conformance table; proceed with standard checklist only; suggest running `/design project` |
| No PR, just "review my changes" | Diff working tree against HEAD, include untracked files |
| Diff is huge (> ~1500 lines) | Review by subsystem, say what you covered and what you did not |
| Tests do not run locally | Say so explicitly; do not claim they pass |
| Change deviates from approved design | Blocker or Major, link to the design section |
| Only nits found | Approve, list nits, say it is clean |
