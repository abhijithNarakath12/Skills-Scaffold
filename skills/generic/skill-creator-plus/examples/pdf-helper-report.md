# Skill audit: pdf-helper

Validator: 8 errors, 11 warnings, 6 notes (full output in pdf-helper-validator-output.txt). Checklist: 10 pass, 30 fail, 6 not applicable.

| Rule | Result | Evidence | Proposed change |
|---|---|---|---|
| FM1 Frontmatter parses | Fail | SKILL.md:4 unquoted ": " in the description; the skill loads with no fields | Change 1 |
| FM2 Valid name | Fail | SKILL.md:2 `Claude_PDF_Helper`: capitals, underscores, reserved word, differs from folder | Change 1: `processing-pdfs`, folder renamed to match |
| FM3 Name says the activity | Fail | SKILL.md:2 "helper" is vague | Change 1 |
| DS2 Third person | Fail | SKILL.md:4 "I can help you" | Change 1 |
| DS3 What and when | Fail | SKILL.md:4 no "Use when" clause, no trigger words | Change 1 |
| ST2 Key instructions at the top | Fail | SKILL.md:9-11 open with filler; the steps start at line 13 | Change 2 |
| ST4 One level deep | Fail | reference/advanced.md:3 links details.md, which SKILL.md never links | Change 3: fold details.md into advanced.md |
| ST5 Contents on long files | Fail | reference/api.md is 124 lines, no contents list | Change 3 |
| ST6 Every file reachable | Fail | SKILL.md:36 dead link to notes.md; doc2.md orphan; SKILL.md.bak inside the skill | Change 3: delete all three |
| ST7 Forward slashes | Fail | SKILL.md:30 uses a backslash in the script path | Change 3 |
| CT1 Concise | Fail | SKILL.md:9 explains what a PDF is (no-op) | Change 2: delete |
| CT2 Freedom matches risk | Fail | SKILL.md:30 form filling has no exact command and no check | Change 4 |
| CT3 Nothing time-sensitive | Fail | SKILL.md:32 `before August 2025` | Change 4: state the current API only |
| CT7 A default, not a menu | Fail | SKILL.md:9 four libraries, "pick whichever you like" | Change 2: pdfplumber for text, pypdf for forms, OCR as the escape hatch |
| CT9 Nothing unfinished | Fail | SKILL.md:34 `TODO` | Change 4 |
| WF1 Checklist with a way back | Fail | SKILL.md:15-18 checklist has no "done when" and no go-back line | Change 4 |
| WF2 Feedback loop | Fail | No step checks the filled PDF | Change 4 |
| SC1 Solve, don't defer | Fail | fill_form.py:12 a missing file ends in a raw traceback | Change 5 |
| SC2 No voodoo constants | Fail | fill_form.py:7-8 `TIMEOUT = 47`, `RETRIES = 5`, unexplained and unused | Change 5: delete |
| SC4 Errors that help | Fail | fill_form.py prints no message of its own on bad input | Change 5 |
| SC5 Install lines | Fail | pdfplumber (SKILL.md:24) and pypdf (fill_form.py:5) have none | Change 5 |
| NM1 Not too prescriptive | Fail | SKILL.md:11 "read this whole file first", "follow each instruction" (no-ops) | Change 2: delete |
| NM2 No reasoning echo | Fail | SKILL.md:20 `write out your reasoning in the reply` | Change 2: delete |
| NM3 The reason | Fail | No rule carries a reason (SKILL.md:11, 31) | Change 4 |
| NM4 Brief steering | Fail | SKILL.md:11 seven capitalised hard words in one line | Change 2 |
| NM5 Verification explicit | Fail | Nothing says how to check the output | Change 4 |
| HK1 Hard rules in hooks | Fail | SKILL.md:31 `must always` run a checker that does not exist | Needs your decision |
| TS1 Evaluations first | Fail | No test prompts in the folder | Change 6 |
| TS2 Fresh-session test | Fail | No record of a with and without run | Change 6 |
| TS3 Tested on target models | Fail | No record; ask which models run it | Change 6 |
| WF3 Plan, validate, execute | N/A | No batch or destructive steps | - |
| CT5 Template strictness | N/A | No templates | - |
| CT6 Examples | N/A | Output is extracted text; style does not matter | - |
| CT8 MCP tool names | N/A | No MCP tools | - |
| LB1 Overlapping descriptions | N/A | Single-skill audit | - |
| LB2 Unused skills | N/A | Single-skill audit | - |
| FM4 Recognised fields | Pass | Note only: `version` is unknown; move it under `metadata:` | Change 1 |
| FM5 Invocation on purpose | Pass | Model-invoked suits a PDF skill | - |
| DS1 Present and within limits | Pass | 73 characters, no tags | - |
| DS4 Key use case first | Pass | Well under 1,536 characters | - |
| ST1 Under 500 lines | Pass | 36 lines in total | - |
| ST3 Split by area | Pass | Advanced use and the API sit in their own files | - |
| CT4 One term per concept | Pass | "field" used throughout | - |
| CT10 One rule, one place | Pass | No rule repeated across files | - |
| WF4 Standing instructions | Pass | One-shot task; steps fit | - |
| SC3 Run or read | Pass | SKILL.md:30 says "run" | - |

## Changes, highest impact first

1. **Fix the frontmatter** - FM1, FM2, FM3, DS2, DS3, FM4. Name `processing-pdfs` (folder renamed), description: "Extracts text from PDFs, fills PDF forms and merges PDF files. Use when the user mentions PDFs, PDF forms, or extracting, filling or merging PDF files." Move `version` under `metadata:`. Why first: today the YAML fails, so the skill has no description and can never trigger on its own.
2. **Cut the filler at the top** - ST2, CT1, CT7, NM1, NM2, NM4. Delete lines 9, 11 and 20; name one default library per job. Line 20 can get the request refused outright on newer models.
3. **Fix the file layout** - ST4 to ST7. Forward slash on line 30, fold details.md into advanced.md, add a contents list to api.md, delete doc2.md, SKILL.md.bak and the notes.md link.
4. **Rewrite the steps** - WF1, WF2, CT2, CT3, CT9, NM3, NM5. A checklist with the exact command (`python scripts/fill_form.py input.pdf values.json output.pdf`), a verify step that opens the output and lists empty fields, "If a field is empty, return to Step 3", a reason on each rule, no dated API lines, merge steps written or the `TODO` removed.
5. **Harden fill_form.py** - SC1, SC2, SC4, SC5. Clear messages for a missing file or bad JSON, unused constants deleted, `pip install pdfplumber pypdf` next to the scripts list.
6. **Add tests** - TS1 to TS3. Three prompts (extract, fill, merge) plus one that should not trigger, run with and without the skill in a fresh session on the model you use most.

## Needs your decision

- **HK1:** line 31 says a checker runs after each save, but the skill has no checker. Option A: add a check script and a `PostToolUse` hook on file writes, so it runs no matter what. Option B: drop the rule. A starts with a new script; B is a one-line delete.
- **Renaming** the folder changes the slash command from `/pdf-helper` to `/processing-pdfs`.

Nothing has been changed yet. Reply with the change numbers to apply.
