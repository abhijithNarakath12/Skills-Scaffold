# Testing skills

Seeing a skill trigger proves Claude found it, not that it did the job. Test two things separately: does it fire on the prompts it should, and is the output right when it does.

## Contents
- Build evaluations first
- Run a baseline in a fresh session
- Claude A writes, Claude B tests
- Watch how Claude navigates
- Test on the models you plan to use
- Test before you delete
- Verify with a fresh context
- Prompts for this skill

## Build evaluations first

Write the tests before the skill, so the skill solves real gaps instead of imagined ones.

1. Run Claude on three or more real tasks with no skill. Note where it fails or needs context you keep repeating.
2. Turn each gap into a test prompt with the behaviour you expect.
3. Record how Claude does without the skill. That is the baseline.
4. Write the smallest skill that closes the gaps.
5. Re-run the tests, compare with the baseline, refine. If a test still fails, return to step 4.

A light format for each test, kept in the skill's repo or an `evals/` folder:

```text
### <short name>
Prompt: <exactly what a user would type>
Should trigger: yes
First file Claude should open: <file>
Done looks like: <one checkable line>
```

Add at least one prompt that should not trigger the skill, to catch a description that grabs too much.

Anthropic's page also shows a JSON shape (`skills`, `query`, `files`, `expected_behavior`) if you want machine-readable tests. There is no built-in runner for that format; Anthropic's skill-creator plugin uses its own `evals/evals.json`.

## Run a baseline in a fresh session

Run each prompt in a new session with the skill on, then again with it off, and compare. A fresh session matters because context left over from writing the skill hides gaps in what it says.

- **Personal or project skill in Claude Code:** turn it off for the second run with `"skillOverrides": { "<skill-name>": "off" }` in settings, or from the `/skills` menu.
- **Skill inside a plugin:** use `claude plugin eval`, which repeats each run with no plugin loaded.
- **To automate it:** Anthropic's skill-creator plugin (`/plugin install skill-creator@claude-plugins-official`) runs with-skill and without-skill passes, grades them and compares token cost and time.

## Claude A writes, Claude B tests

Work with one Claude (A) to write and refine the skill. Give it to a fresh Claude (B) with real tasks, not test scenarios. Watch B. Bring each miss back to A with the specifics: "B wrote the report but skipped the date filter, even though the skill mentions it. Is the rule buried?" Repeat until B handles new tasks without help.

## Watch how Claude navigates

While B works, note:

- **Unexpected order:** files read in an order you did not plan. The structure is less clear than you think.
- **Missed links:** an important file never opened. Make the pointer more explicit, or move the content into SKILL.md.
- **The same file every run:** that content probably belongs in SKILL.md.
- **A file never opened:** it is unneeded or badly signposted. Delete it or say when to read it.

## Test on the models you plan to use

A skill adds to a model, so results depend on the model. Ask one question per model:

- **Haiku:** does the skill give enough guidance?
- **Sonnet:** is it clear and efficient?
- **Opus:** does it avoid over-explaining?

Test prudently. Run the full sweep for skills you rely on heavily or that can cost money, delete data or publish. For the rest, test on the model you use most and widen only when something looks off. A full sweep of every skill on every model burns tokens for little gain.

## Test before you delete

Newer models often do better with fewer instructions, but a line that looks redundant may be holding up one edge case. Before cutting instructions for being too prescriptive:

1. List the candidate lines and why each might be dead weight.
2. Copy the skill, remove the candidates in the copy, and run the evaluations on both versions in fresh sessions, on the model the skill runs on.
3. Keep a removal only where the slim version does as well or better. Restore any line whose removal changed the result.
4. Note the evidence in the change list: which test, which model, what changed.

## Verify with a fresh context

When the skill's output matters, check it with a separate Claude that did not do the work, given the spec and the result. Fresh-context verifiers tend to catch more than self-review. Use the same idea inside long workflows: "after each stage, have a subagent check the output against the spec".

## Prompts for this skill

### Audit one skill
Prompt: `audit my deploy skill against Anthropic's rules`
Should trigger: yes
First file Claude should open: references/audit-checklist.md, after running the validator
Done looks like: a report with one row per rule, fails first, and no files changed

### Audit a library
Prompt: `check every skill in ~/.claude/skills and tell me what to fix first`
Should trigger: yes
First file Claude should open: the validator's `--all` table, then references/audit-checklist.md
Done looks like: the summary table, full reports for the skills the user picks, no files changed

### New skill from a repeated task
Prompt: `make this a skill, we write release notes like this every Friday`
Should trigger: yes
First file Claude should open: references/testing.md, to write the evaluations first
Done looks like: a new folder that passes the validator and its three test prompts

### Refine after a miss
Prompt: `the report skill keeps forgetting the date filter, fix it`
Should trigger: yes
First file Claude should open: the report skill's SKILL.md, then references/audit-checklist.md
Done looks like: the rule rewritten with its reason near the top, file no longer than before, validator clean

### Should not trigger
Prompt: `write a Python script that renames my photos by date`
Should trigger: no
