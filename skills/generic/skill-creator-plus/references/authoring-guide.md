# Authoring guide

How to write each part of a skill so Claude takes the same process on each run. The rules themselves, with IDs, are in audit-checklist.md; this file is the how.

## Contents
- Frontmatter fields
- The description
- Naming
- Shape and structure
- Degrees of freedom
- Workflows and feedback loops
- Templates, examples, options and terms
- Scripts and packages
- Hooks for rules that cannot bend
- Writing for newer models
- Judgment tools

## Frontmatter fields

The opening `---` sits on line 1. Quote any value that contains `: `, starts with `[`, `{`, `@` or a backtick, or holds a backslash; otherwise the YAML fails and the skill loads with no fields.

| Field | What it does | Works outside Claude Code |
|---|---|---|
| `name` | Lowercase letters, numbers, hyphens, max 64. Becomes the slash command | Yes |
| `description` | What the skill does and when to use it. Max 1,024 characters | Yes |
| `license`, `compatibility`, `metadata` | Licence, environment needs (max 500 characters), free-form data | Yes |
| `allowed-tools` | Tools Claude may use without asking, for the turn that invokes the skill | Yes |
| `when_to_use` | Extra trigger phrases, appended to the description | No |
| `disable-model-invocation` | `true` = only a person can start it; the description leaves Claude's context | No |
| `user-invocable` | `false` = only Claude can start it; hidden from the `/` menu | No |
| `argument-hint`, `arguments` | Autocomplete hint; named arguments for `$name` substitution | No |
| `paths` | Globs. Claude loads the skill on its own only for matching files | No |
| `context`, `agent`, `background` | `context: fork` runs the skill in a subagent with no chat history | No |
| `model`, `effort` | Model or effort while the skill runs | No |
| `hooks` | Hooks registered when the skill runs, for the rest of the session | No |
| `shell`, `disallowed-tools` | Shell for injected commands; tools removed while active | No |

For a skill you will upload to claude.ai or the Skills API, use only the six fields marked Yes. Anything else makes the upload fail. Put your own data (version, author) under `metadata:`.

Pick invocation by who should start the skill. Side effects you want to control (deploy, send, pay) get `disable-model-invocation: true`. Background knowledge that is not an action gets `user-invocable: false`. Everything else stays model-invoked, which costs its description in context on each turn.

## The description

The description is the only part of a skill Claude sees before choosing it. Write it as a trigger.

1. **What, then when.** One sentence on what the skill does, then "Use when ..." with the situations and words people actually type.
2. **Key use case first.** Claude Code cuts `description` plus `when_to_use` at 1,536 characters in the skill listing, and drops whole descriptions of rarely used skills when the listing is over budget.
3. **Third person.** It is injected into the system prompt. "Processes Excel files and generates reports", not "I can help you" or "You can use this".
4. **One trigger per branch.** Synonyms that rename one job are duplication. Keep the distinct jobs.
5. **Name situations plainly.** Claude tends to under-use skills rather than over-use them, so name the cases where the skill applies instead of hinting.

Good, from Anthropic's page:

```yaml
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.
```

Too vague to choose from 100 skills: "Helps with documents", "Processes data".

A manual-only skill (`disable-model-invocation: true`) is never matched by Claude, so its description can be a plain one-line summary for people.

## Naming

Prefer the activity in gerund form: `processing-pdfs`, `analyzing-spreadsheets`. Noun phrases (`pdf-processing`) and actions (`process-pdfs`) are fine. Avoid vague names (`helper`, `utils`, `tools`), generic ones (`documents`, `data`), the reserved words "anthropic" and "claude", and mixing patterns in one library. Keep the `name` field and the folder name the same.

## Shape and structure

SKILL.md is a table of contents, not a manual. Claude reads it when the skill fires and opens other files only when a step points at them.

| Shape | Use when |
|---|---|
| Single file | One job, short enough to read whole |
| Bundle | One job, with reference material or scripts that only some runs need |
| Router | Several distinct jobs in one domain; SKILL.md holds a table that sends each job to its own file |

Order SKILL.md by importance: the rules that matter most go near the top, because after compaction Claude Code keeps only the first 5,000 tokens of a skill. Write standing instructions ("check the output after each change"), not one-time steps, because the file is loaded once and not re-read on later turns.

Three ways to disclose detail, from Anthropic's page:

1. **Guide with references.** Quick start in SKILL.md, each advanced topic in its own linked file.
2. **By domain.** One file per area (`reference/finance.md`, `reference/sales.md`), so a sales question never loads finance. Give `grep` hints for big files.
3. **Conditional details.** The common path inline, the rare path behind a link.

Every reference file is linked straight from SKILL.md, never only from another reference file. A file over 100 lines opens with a `## Contents` list. Name files for what they hold. Keep backups and drafts outside the skill folder.

## Degrees of freedom

Match how tightly you specify a step to how fragile it is.

| Freedom | Form | Use when | Example |
|---|---|---|---|
| High | Plain instructions | Many approaches work; context decides | Code review: "check structure, edge cases, readability" |
| Medium | A template or a script with parameters | One pattern is preferred, some variation is fine | `generate_report(data, format="markdown")` |
| Low | An exact script, few or no parameters | Mistakes are costly or the order must not change | `python scripts/migrate.py --verify --backup`, "do not add flags" |

Anthropic's picture: a narrow bridge with cliffs gets exact guardrails; an open field gets a direction and trust.

Two habits from practice:

- **Mix levels inside one skill.** A content skill can leave the writing at high freedom and lock the publishing step to one exact command.
- **Ask "what if Claude does this step differently?"** If the answer is "nothing bad", loosen the step. If it is "money spent, data deleted, something published", lock it to a script and put a check before it.

## Workflows and feedback loops

For multi-step work, give Claude a checklist to copy into its reply and tick. Each step ends on a checkable "done when", and the checklist says where to go back when a check fails.

```text
Task progress:
- [ ] Step 1: Analyse the form (run scripts/analyze_form.py)
- [ ] Step 2: Write the field mapping (fields.json)
- [ ] Step 3: Validate the mapping (run scripts/validate_fields.py)
- [ ] Step 4: Fill the form
- [ ] Step 5: Verify the output. If it fails, return to Step 2.
```

**Feedback loop.** Run the check, fix, repeat, and only move on when the check passes. The check does not have to be code: "compare the draft against STYLE_GUIDE.md and list each miss" works the same way.

**Conditional workflow.** Name the decision first ("Creating new content or editing existing?"), then give each branch its own steps. When branches grow long, move each into its own file.

**Plan, validate, execute.** For batch, destructive or high-stakes jobs, Claude writes the plan to a file (for example `changes.json`), a script checks it, and only then does anything run. Errors surface before anything changes, and the plan can be revised without touching the originals.

## Templates, examples, options and terms

- **Templates.** Say how strict. "Use this exact structure" for data formats and API responses. "A sensible default; adapt the sections to the material" for reports.
- **Examples.** When output style matters, show two or three input and output pairs. They pin down style faster than any description.
- **One default.** "Use pdfplumber for text. For scanned PDFs that need OCR, use pdf2image with pytesseract." A default plus one escape hatch, never a list of five libraries.
- **One term per concept.** Pick "field" and keep it. Mixed terms read as different things.
- **Nothing time-sensitive.** State the current method. Put old methods under an `## Old patterns` heading, inside a `<details>` block if they are long.

## Scripts and packages

Bundle a script when the same code would be rewritten on each run, when the result must be identical each time, or when the logic deserves testing.

- **Say run or read.** "Run `scripts/analyze_form.py` to list the fields" (the default; only the output costs tokens) or "See `scripts/analyze_form.py` for the algorithm".
- **Solve, don't defer.** Handle the expected failures in the script (missing file, no permission) and print what happened.
- **Explain constants.** `TIMEOUT = 30  # most requests finish well inside 30 seconds`, never a bare `47`.
- **Errors that help.** Name the problem and the fix: "Field 'signature_date' not found. Available fields: customer_name, order_total".
- **List packages with an install line** next to the script that needs them, for example `pip install pypdf`. Claude Code and claude.ai can install packages. The Claude API has no network access and no runtime installs, so a skill meant for the API can only use what its code execution environment already has.
- **MCP tools by full name.** `BigQuery:bigquery_schema`, not `bigquery_schema`.
- **Claude Code extras.** `${CLAUDE_SKILL_DIR}` expands to the skill's folder, so `python ${CLAUDE_SKILL_DIR}/scripts/x.py` works from any working directory. The same variable in `allowed-tools` (for example `Bash(${CLAUDE_SKILL_DIR}/scripts/x.py *)`) lets the script run without a permission prompt. Both are Claude Code only.

## Hooks for rules that cannot bend

Prose is followed with judgment. It can be skipped, and after compaction only the start of a skill stays in context. A hook is run by Claude Code on its event, whether or not Claude is following the skill. So a rule that has to hold on each run (block a dangerous command, run a check before each file edit) belongs in a hook.

A skill can carry its own hooks in frontmatter. They register when the skill is invoked and stay for the rest of the session. Add `once: true` to a hook that should run only on its first success.

```yaml
---
name: safe-deploying
description: Deploys the app to staging with a safety check on each shell command. Use when the user asks to deploy or ship to staging.
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/check-command.sh"
---
```

Keep judgment in prose and hard lines in hooks. Hooks are Claude Code only; for claude.ai, keep the rule in prose and near the top. Full format: https://code.claude.com/docs/en/hooks#hooks-in-skills-and-agents

## Writing for newer models

Claude Fable 5, Opus 5.5 and Sonnet 5.5 follow instructions closely and do more on their own. Five adjustments:

1. **Cut scaffolding they no longer need.** Skills written for earlier models are often too prescriptive and can make output worse. Find the hand-holding (step-by-step walkthroughs of things the model knows, long lists of behaviours, common sense restated) and test removing it. Delete only what the test says is dead weight (testing.md, "Test before you delete").
2. **Never ask for the reasoning in the reply.** Instructions to write out, echo or transcribe the model's reasoning can be declined with the `reasoning_extraction` refusal. Ask for the answer, a short explanation of it, or a summary of the actions taken.
3. **Give the reason.** "Keep under 1,536 characters, because Claude Code cuts the listing there" lets Claude handle cases the rule did not foresee, and tells a later editor when the rule has stopped mattering.
4. **Steer briefly.** One short instruction ("lead with the outcome, then the detail") works as well as listing each unwanted behaviour. Save capitals for real hard lines; when everything shouts, nothing stands out.
5. **Make verification explicit.** Say how the work gets checked and when. For long or high-stakes runs, a fresh-context verifier (a subagent that did not do the work, checking against the spec) tends to beat self-critique.

## Judgment tools

These terms come from Matt Pocock's "writing-great-skills".

- **Predictability is the goal.** A skill succeeds when Claude takes the same process each run, not when it produces identical output.
- **The no-op test.** For each sentence, ask: would Claude behave differently without it? If not, delete the whole sentence rather than trimming words.
- **Leading words.** A compact idea the model already knows (a "tight" loop, a "red" test) can replace a sentence of explanation. Use the same word in the description and the body so both point at the same behaviour.
- **Completion criteria.** "Produce a change list" invites a rushed finish. "Every changed file has a line in the list" does not. Make each "done when" checkable and, where it matters, exhaustive.
- **When to split.** Split off a new model-invoked skill only when it has its own trigger words or another skill must reach it, because each description costs context on each turn. Split a long run of steps into separate files when the later steps tempt Claude to rush the current one.
- **One rule, one place.** When new evidence arrives, find the principle behind it and rewrite the existing rule around that principle. Do not append a new block under the old one. A good refinement usually makes the file shorter.
