# Authoring bundled skills

Every bundled skill lives at `skills/<category>/<id>/` and contains:

```
skills/frameworks/react/
├── SKILL.md        # the skill (Agent Skills open standard), copied into projects
├── skill.json      # extension-only metadata: title, tags, detect rules, upstream sources
└── references/     # optional: longer reference material linked from SKILL.md
```

Categories: `generic` (engineering workflows), `languages`, `frameworks`, `libraries`, `tooling`.

## SKILL.md

Follows the [Agent Skills specification](https://agentskills.io/specification):

```markdown
---
name: react                # must equal the folder name; lowercase, digits, hyphens
description: One to three sentences. Say WHAT the skill covers and WHEN an agent should load it. Mention the trigger words (library names, file types, tasks). Max 1024 chars.
---

# Title

## When to use
## Project conventions to detect first      (what to look at in the repo before acting)
## Core guidance                              (the rules that matter, with short code examples)
## Common tasks                               (step lists for the 4–8 most frequent jobs)
## Pitfalls                                   (things agents get wrong)
## Verification                               (commands to run: tests, lint, type-check, build)
## References                                 (links to references/*.md and official docs)
```

Guidelines:

- Agents load only `name` + `description` up front and the body only when relevant, so the description must make triggering obvious.
- Be concrete and current. Prefer the modern idiom (e.g. React function components + hooks, Python 3.11+ typing, Go 1.22 loop vars, Java 21 records) and say which version the advice assumes.
- Write for an agent that will **act**: imperative steps, exact commands, file locations, and what "done" looks like.
- 150–400 lines in `SKILL.md`. Move longer material into `references/` and link it with relative paths (`references/testing.md`). The validator checks links.
- Always include a **Verification** section with the project's typical commands (and how to discover them: `package.json` scripts, `Makefile`, `pyproject.toml`).
- Do not invent APIs. If unsure about a detail, describe how to check it (`--help`, docs URL) instead of guessing.
- No marketing, no history lessons, no generic programming advice that applies to every language.

## skill.json

```json
{
  "title": "React",
  "tags": ["frontend", "ui", "javascript"],
  "detect": {
    "npm": ["react", "react-dom"],
    "extensions": [".jsx", ".tsx"]
  },
  "recommends": ["typescript"],
  "upstream": [
    { "repo": "vercel-labs/agent-skills", "path": "skills/react-best-practices", "note": "Vercel's React performance guidelines" }
  ]
}
```

- `detect` keys: `npm`, `pip`, `go`, `cargo`, `jvm` (groupId or groupId:artifactId), `gem`, `composer`, `nuget`, `pub`, `swift`, `files` (names/globs), `extensions`. Matching any rule recommends the skill. Prefer dependency rules over extension rules; extension-only rules should be used for languages.
- `recommends`: other bundled skill ids installed together with this one (e.g. `nextjs` recommends `react`).
- `upstream`: real, verified community skills on the same topic. Only list a repo/path you have confirmed exists.
- `rule` (optional): one paragraph written into the project's agent instruction file (CLAUDE.md, AGENTS.md, Cursor/Windsurf rules, Copilot instructions) while the skill is installed. Use only for behaviour that must apply to every task, such as `plan-feature`.
- `commands` (optional): `[{ "name": "design", "description": "...", "prompt": "... $ARGUMENTS" }]`. Generates project slash commands for agents that support them; `$ARGUMENTS` is replaced by the agent's own placeholder.

## Validation

```
npm run validate:skills   # spec and convention checks
npm run build:catalog     # regenerates skills/catalog.json
```
