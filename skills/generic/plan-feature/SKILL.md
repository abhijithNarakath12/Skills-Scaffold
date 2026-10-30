---
name: plan-feature
description: Plan before writing code, every time. Produces a written implementation plan (goal, scope, approach, ordered steps, risks, verification) and waits for explicit approval before any implementation starts. Use for every request to add, build, implement, fix, change, migrate, configure or refactor something; trivial changes get a short micro-plan but still require a go-ahead.
---

# Plan before implementing

This skill enforces a simple contract: **no implementation until the plan is approved.** A plan is a short document that the user can read in two minutes, disagree with, and correct cheaply, before expensive code changes are made.

## When to use

**Always.** While this skill is installed, every request that would change project files goes through a plan and an approval, including features, bug fixes, refactors, configuration, dependency and migration changes.

Pick the plan size from the change, not whether to plan:

| Change | Plan form |
|---|---|
| One-line fix, typo, rename, comment, obvious config tweak | **Micro-plan**: 3-5 lines in chat (what, which file(s), how verified). Still wait for a go-ahead. No plan file needed. |
| Anything touching more than one file, a public interface, a data model, a schema, a dependency, or with more than one reasonable approach | **Full plan** written to `docs/plans/` as described below. |
| Large feature or unclear data model and interfaces | `design-doc` skill first, then a full plan derived from the approved design. |

The only exceptions: pure questions and explanations (no files change), and a request where the user explicitly says to skip planning for that request ("no plan", "just do it, skip the plan"). A standing instruction from the user to skip planning turns this skill off until they turn it back on; record that in the conversation and respect it.

The plan is the *how and in what order*; the design document (`design-doc` skill, `/design`) is the *what and why*.

## Workflow

### 1. Understand before planning

1. Restate the request in one or two sentences in your own words.
2. Read the relevant code. Find the entry points, the modules you would touch, existing patterns (naming, error handling, tests, folder layout) and anything that already does something similar.
3. Identify constraints: language/framework versions, lint and test setup, CI, coding standards in `CONTRIBUTING.md`, `AGENTS.md`, `CLAUDE.md` or similar files.
4. If something essential is ambiguous and changes the plan materially, ask at most three focused questions **before** writing the plan. Otherwise state your assumptions in the plan and proceed.

### 2. Write the plan

Create the plan as a Markdown file so it survives the conversation and can be reviewed in a PR:

- Path: `docs/plans/YYYY-MM-DD-<short-slug>.md` (create the folder if needed). If the project already has a plans/ADR/RFC directory, use that instead.
- Use the structure in [references/plan-template.md](references/plan-template.md). Keep it tight: a typical plan is 60 to 150 lines.
- Every step must name the files it touches and how it will be verified (test command, manual check, expected output).
- List risks honestly, including the ones you cannot fully mitigate.
- Include **Non-goals** so scope creep is visible.
- If there are alternatives, give the one you recommend and a one-line reason for rejecting each other option.

Also print the plan in the chat (or a faithful summary if it is long) so the user does not have to open the file.

### 3. Stop and ask for approval

End your message with an explicit question such as:

> Plan written to `docs/plans/2025-01-15-add-rate-limiting.md`. Do you approve this plan, or would you like changes? I will not start implementing until you confirm.

Then **stop**. Do not create, edit or delete any source file, do not run migrations, do not install packages. Reading files and running read-only commands (tests, linters, `git status`) is fine.

Approval means the user says something like "approved", "go ahead", "LGTM", "yes, implement", "proceed". If the user replies with questions, change requests or partial approval, revise the plan, update the file, and ask again. If they say "just do it" without reading, treat that as approval but still keep the plan file as the record.

Never proceed on silence or on an ambiguous reply.

### 4. Implement step by step

After approval:

1. Work through the steps in the order written. Tick each step's checkbox in the plan file as it is completed.
2. Run the verification listed for each step before moving to the next one. Do not batch all verification to the end.
3. If reality differs from the plan (a step is unnecessary, a new step is needed, an approach does not work), **say so immediately**, add a short "Deviations" note to the plan, and ask before deviating if the change is significant (new dependency, schema change, different architecture). Small deviations (a helper function, a renamed variable) can be noted without asking.
4. Keep commits or change sets aligned with plan steps when the user wants commits.

### 5. Close out

When the last step is verified:

- Update the plan's status to `Done`, and add a "Result" section: what was built, how it was verified, anything left for follow-up.
- Summarize for the user: what changed (files), how to try it, known limitations, suggested next steps.
- If the project uses the `review-pr` skill, suggest running it on the result.

## Rules

- **The plan is the contract.** Scope not in the plan does not get implemented without a conversation.
- **Keep it reviewable.** If a plan is over ~200 lines, it is probably two plans, or it needs a design document first.
- **Prefer reversible steps early.** Put schema changes, dependency additions and public API changes in their own steps with explicit verification.
- **Tests are part of the plan**, not an afterthought. Every behavior-changing step says which test proves it.
- **Be concrete.** "Update the service" is not a step. "Add `rateLimit(userId)` to `src/services/limits.ts`, called from `POST /api/messages` handler in `src/routes/messages.ts`; unit test in `src/services/limits.test.ts`" is a step.
- **Do not pad.** No motivational text, no restating the template headings when a section is empty; write "None" instead.

## Quick reference

| Situation | Action |
|---|---|
| Request is a one-liner or trivial | Micro-plan in chat, wait for go-ahead, then do it |
| User says "skip the plan" for this request | Do it directly, say that planning was skipped on request |
| Request needs new data structures or has unclear requirements | `design-doc` first, then plan |
| User asks a question only | Answer, no plan |
| User approved but asks for one more thing mid-way | Add a step to the plan, confirm, continue |
| A step fails verification | Fix within the step; if the approach is wrong, stop and re-plan that step |
