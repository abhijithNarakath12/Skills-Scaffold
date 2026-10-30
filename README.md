# Agent Skills Manager (VS Code extension)

Give your AI coding agents the right knowledge for your stack in one click.

This extension adds **skills** to a project: small folders containing a `SKILL.md` that follow the open [Agent Skills](https://agentskills.io) standard, understood by Claude Code, GitHub Copilot, Cursor, OpenAI Codex, Gemini CLI, Windsurf, OpenCode and others. It ships a curated catalog for popular languages, frameworks, libraries and tooling, detects what your project uses, and installs matching skills into the directory your agent reads.

It also ships three **engineering workflow skills** that change how an agent works, not just what it knows:

| Skill | What it enforces |
|---|---|
| `plan-feature` | Writes an implementation plan (goal, scope, steps, risks, verification) to `docs/plans/` and **waits for your approval** before touching code. |
| `design-doc` | Produces a design document in `docs/design/` that catalogues **every data structure** the feature uses, interfaces, algorithms with time/space complexity, data flow, testing and rollout. Implementation starts **only after the document is approved**, and the document is kept up to date afterwards. |
| `review-pr` | Reviews a PR, branch or diff against a checklist, produces severity-ranked findings tied to `file:line` with fixes, runs the tests, and gives a verdict. |

## Quick start

1. Install the extension and open a project.
2. Open the **Agent Skills** view in the activity bar (or run `Agent Skills: Add Recommended Skills for This Project`).
3. Confirm the pre-selected skills. They are copied to `.claude/skills/<skill>/` by default.
4. Start your agent. It will load the skills automatically when relevant (for example, when you ask it to "add a feature", the `plan-feature` skill kicks in and asks for approval first).

## Commands

| Command | Description |
|---|---|
| Agent Skills: Add Recommended Skills for This Project | Detects your stack and offers matching skills plus the workflow skills. |
| Agent Skills: Add Skills to Project... | Browse the whole catalog, grouped by category, with recommendations pre-selected. |
| Agent Skills: Add Workflow Skills | Installs `plan-feature`, `design-doc` and `review-pr`. |
| Agent Skills: Browse Community Skill Sources... | Lists skills in configured GitHub repositories (Anthropic, Vercel, Superpowers by default) and installs the ones you pick. |
| Agent Skills: Add Skill from GitHub Repository... | Install from any `owner/repo`, `owner/repo/path/to/skill`, or github.com URL. |
| Agent Skills: Create New Skill in Project... | Scaffold a project-specific skill from a template. |
| Agent Skills: Update Installed Skills | Refresh bundled skills when the extension ships newer versions (your edits are overwritten after confirmation). |
| Agent Skills: Remove Skill from Project | Delete a skill from all configured targets. |
| Agent Skills: Select Target Agents... | Choose which agent directories receive skills. |

## Where skills are installed

| Target | Directory |
|---|---|
| Claude Code (default) | `.claude/skills/` |
| Universal / Codex | `.agents/skills/` |
| Cursor | `.cursor/skills/` |
| GitHub Copilot | `.github/skills/` |
| Gemini CLI | `.gemini/skills/` |
| Windsurf | `.windsurf/skills/` |
| OpenCode | `.opencode/skills/` |
| Custom | `agentSkills.customTargetDirectory` |

With several targets selected, the first target gets the real files and the others get relative symlinks to it, so there is one copy to edit and commit. Set `agentSkills.linkSecondaryTargets` to `false` to copy instead.

Each installed skill folder also contains a small `.agent-skills.json` manifest recording where it came from and its version. Delete it if you want to detach the skill from updates.

## Stack detection

The extension reads dependency manifests in the top two directory levels (`package.json`, `requirements*.txt`, `pyproject.toml`, `Pipfile`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle[.kts]`, `Gemfile`, `composer.json`, `*.csproj`, `pubspec.yaml`, `Package.swift`, `Podfile`) and samples source file extensions, skipping `node_modules`, build outputs and virtual environments. Nothing leaves your machine.

## Settings

| Setting | Default | Description |
|---|---|---|
| `agentSkills.targets` | `["claude"]` | Agent directories to install into; the first is primary. |
| `agentSkills.customTargetDirectory` | `.agent-skills` | Used by the `custom` target. |
| `agentSkills.linkSecondaryTargets` | `true` | Symlink secondary targets to the primary copy. |
| `agentSkills.recommendOnOpen` | `true` | One-time suggestion when a project with a detectable stack has no skills yet. |
| `agentSkills.remoteSources` | Anthropic, Vercel, Superpowers | GitHub repositories offered in "Browse Community Skill Sources". |
| `agentSkills.githubToken` | `""` | Optional token for the GitHub API (or set `GITHUB_TOKEN`). |

## Bundled catalog

Run `Agent Skills: Add Skills to Project...` to see the full list. Categories:

- **Engineering workflows**: plan-feature, design-doc, review-pr.
- **Languages**: TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, C#, C++, Swift, Ruby, PHP, Dart, Scala, SQL, Bash.
- **Frameworks**: React, Next.js, Vue, Nuxt, Angular, Svelte/SvelteKit, React Router/Remix, Astro, React Native, Flutter, Express, NestJS, Fastify, Hono, FastAPI, Django, Flask, Spring Boot, Rails, Laravel, ASP.NET Core, Gin.
- **Libraries**: Tailwind CSS, Prisma, Drizzle, SQLAlchemy, TanStack Query, Redux Toolkit, Zustand, Zod, GraphQL, Pydantic, pandas, React Hook Form, Socket.IO, HTTP clients.
- **Tooling**: Docker, Kubernetes, Terraform, GitHub Actions, Vitest, Jest, pytest, Playwright, Cypress, PostgreSQL, MongoDB, Redis, ESLint/Prettier, Git workflow.

Where a well-known community skill exists for the same topic (for example Vercel's React guidelines), the catalog entry records it as an *upstream* source so you can install that version instead via "Browse Community Skill Sources".

## Writing your own skills

`Agent Skills: Create New Skill in Project...` scaffolds a `SKILL.md`. Keep the frontmatter `name` equal to the folder name and write a description that says when the skill should be used; agents read only the description to decide whether to load the rest. See [docs/SKILL-AUTHORING.md](docs/SKILL-AUTHORING.md) for the conventions used by the bundled skills and how to contribute one.

## Development

```bash
npm install
npm run build        # builds catalog.json, type-checks, bundles to dist/
npm test             # validates skills, builds catalog, runs unit tests
npm run package      # produces a .vsix
```

Press F5 in VS Code to launch an Extension Development Host.

## License

MIT. Bundled skills are MIT as well; community skills installed from GitHub keep their own licenses, which you should review.
