#!/usr/bin/env python3
"""Scaffold a new skill folder that passes validate_skill.py out of the box.

Usage:
  python3 init_skill.py <skill-name> [--path FOLDER] [--refs] [--router] [--scripts] [--user-invoked]

  --path FOLDER    where to create the skill. Default: .claude/skills under the
                   current folder (project skills). Personal skills live in
                   ~/.claude/skills.
  --refs           add references/reference.md, linked from SKILL.md
  --router         like --refs, plus a table that sends each job to its own file
  --scripts        add an empty scripts/ folder
  --user-invoked   add disable-model-invocation: true (only a person can start it)

The scaffold holds [FILL: ...] placeholders. The validator reports them as
warnings until each one is replaced. It refuses to overwrite an existing folder.

Exit codes: 0 = created, 1 = refused (bad name or folder exists), 2 = bad arguments.
Standard library only, Python 3.8 or newer.
"""

import argparse
import sys
from pathlib import Path

# Importing the validator would otherwise leave a __pycache__ folder inside the skill.
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import validate_skill  # noqa: E402  (same folder; holds the shared name rules)

# Claude Code downloads skills synced from claude.ai into a "synced" subfolder of
# the skills folder, so a skill with that name would collide with it.
EXTRA_RESERVED = {"synced"}

SKILL_TEMPLATE = """---
name: {name}
description: "[FILL: what this skill does, in third person, key use case first]. Use when the user [FILL: the words people actually type to ask for it]."
{extra}---

# {title}

[FILL: one or two lines on what this skill is for and the principle it serves.]

## Rules for every run

1. [FILL: the rule that matters most, with its reason, so a later editor can tell when it stops applying.]
{router}
## Workflow

Copy this checklist and tick it off:

```text
Progress:
- [ ] Step 1: [FILL: first step]
- [ ] Step 2: [FILL: second step]
- [ ] Step 3: Check the result
```

**Step 1.** [FILL: what to do]. Done when [FILL: a checkable finish line].

**Step 2.** [FILL: what to do]. Done when [FILL: a checkable finish line].

**Step 3.** [FILL: how to check the result]. If the check fails, return to Step 2.

## Resources

{resources}
"""

ROUTER_BLOCK = """
## Pick the branch

Read only the file for the job in hand.

| Doing... | Read | Covers |
|---|---|---|
| [FILL: job one] | [references/reference.md](references/reference.md) | [FILL: what the file holds] |
"""

REFERENCE_TEMPLATE = """# Reference

[FILL: detail that only some runs need. Once this file passes 100 lines, start it with a Contents list.]
"""


def main(argv=None):
    parser = argparse.ArgumentParser(description="Scaffold a new skill folder.")
    parser.add_argument("name", help="lowercase letters, numbers and hyphens, max 64 characters")
    parser.add_argument("--path", default=".claude/skills", help="folder to create the skill in")
    parser.add_argument("--refs", action="store_true", help="add references/reference.md")
    parser.add_argument("--router", action="store_true", help="add a branch table and a reference file")
    parser.add_argument("--scripts", action="store_true", help="add an empty scripts/ folder")
    parser.add_argument("--user-invoked", action="store_true", help="only a person can start the skill")
    args = parser.parse_args(argv)

    name = args.name.strip()
    errors = [msg for level, rule, msg in validate_skill.name_problems(name) if level == "ERROR"]
    if name in EXTRA_RESERVED:
        errors.append("'%s' is the folder Claude Code uses for skills synced from claude.ai." % name)
    if errors:
        for msg in errors:
            print("Refused: " + msg)
        return 1

    base = Path(args.path).expanduser()
    target = base / name
    if target.exists():
        print("Refused: %s already exists. Pick another name or refine the existing skill."
              % validate_skill.posix(target.resolve()))
        return 1

    want_refs = args.refs or args.router
    target.mkdir(parents=True)
    resources = []
    if want_refs:
        (target / "references").mkdir()
        (target / "references" / "reference.md").write_text(REFERENCE_TEMPLATE, encoding="utf-8")
        resources.append("- [references/reference.md](references/reference.md) - [FILL: what it holds and "
                         "when to open it].")
    if args.scripts:
        (target / "scripts").mkdir()
        resources.append("- `scripts/` - [FILL: name each script, say whether to run it or read it, and give "
                         "the install line for any package it needs].")
    if not resources:
        resources.append("[FILL: link each bundled file with a line on when to open it, or delete this section.]")

    skill_text = SKILL_TEMPLATE.format(
        name=name,
        title=" ".join(w.capitalize() for w in name.split("-")),
        extra="disable-model-invocation: true\n" if args.user_invoked else "",
        router=ROUTER_BLOCK if args.router else "",
        resources="\n".join(resources),
    )
    (target / "SKILL.md").write_text(skill_text, encoding="utf-8")

    print("Created %s" % validate_skill.posix(target.resolve()))
    print()
    report = validate_skill.validate(target, validate_skill.posix(target))
    validate_skill.print_report(report)
    print()
    print("Next: replace every [FILL: ...] placeholder, then run validate_skill.py on the folder again.")
    return 1 if report.count("ERROR") else 0


if __name__ == "__main__":
    sys.exit(main())
