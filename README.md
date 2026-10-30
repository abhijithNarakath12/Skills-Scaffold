# Agent Skills Manager (VS Code extension)

Give your AI coding agents the right knowledge for your stack in one click.

This extension adds **skills** to a project: small folders containing a `SKILL.md` that follow the open [Agent Skills](https://agentskills.io) standard, understood by Claude Code, GitHub Copilot, Cursor, OpenAI Codex, Gemini CLI, Windsurf, OpenCode and others. It ships a curated catalog for popular languages, frameworks, libraries and tooling, detects what your project uses, and installs matching skills into the directory your agent reads.

It also ships three **engineering workflow skills** that change how an agent works, not just what it knows:

| Skill | Slash command | What it enforces |
|---|---|---|
| `plan-feature` | (always on, no command needed) | **Always on once installed.** Every change gets an implementation plan (goal, scope, steps, risks, verification) in `docs/plans/`, or a micro-plan in chat for trivial edits, and the agent **waits for your approval** before touching code. Say "skip the plan" to bypass it for one request. |
| `design-doc` | `/design <feature>` | Produces a design document in `docs/design/` that catalogues **every data structure** the feature uses, interfaces, algorithms with time/space complexity, data flow, testing and rollout. Implementation starts **only after the document is approved**, and the document is kept up to date afterwards. |
| `review-pr` | (ask: "review this PR / my changes") | Reviews a PR, branch or diff against a checklist, produces severity-ranked findings tied to `file:line` with fixes, runs the tests, and gives a verdict. |

### How "always on" and slash commands work

Agents load a skill only when a request looks relevant, so a skill alone cannot guarantee it runs every time. When you install a skill that declares an always-on rule (currently `plan-feature`), the extension writes that rule into the agent's instruction file inside a managed block:

| Target | Instruction file | Slash commands |
|---|---|---|
| Claude Code | `CLAUDE.md` | `.claude/commands/<name>.md` |
| Cursor | `.cursor/rules/agent-skills.mdc` (alwaysApply) | `.cursor/commands/<name>.md` |
| GitHub Copilot | `.github/copilot-instructions.md` | `.github/prompts/<name>.prompt.md` |
| Gemini CLI | `GEMINI.md` | `.gemini/commands/<name>.toml` |
| Windsurf | `.windsurf/rules/agent-skills.md` (always_on) | `.windsurf/workflows/<name>.md` |
| OpenCode | `AGENTS.md` | `.opencode/command/<name>.md` |
| Codex / universal / custom | `AGENTS.md` | not supported by the agent |

The block is delimited by `<!-- agent-skills-manager:begin -->` and `<!-- agent-skills-manager:end -->`, is rewritten when skills are added or removed, and never touches the rest of the file. Generated command files carry a `generated-by: agent-skills-manager` marker; a command file you wrote yourself with the same name is left alone. Turn either behaviour off with `agentSkills.enforceRules` or `agentSkills.createSlashCommands`, and run **Agent Skills: Re-apply Always-on Rules and Slash Commands** after changing targets.

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
| Agent Skills: Browse Community Skill Sources... | Lists skills in configured GitHub repositories (Anthropic, Vercel, Superpowers, GitHub awesome-copilot, OpenAI curated by default) and installs the ones you pick. |
| Agent Skills: Install Community Version... | For a catalog topic, installs a verified community skill on the same subject (for example Vercel's React guidelines or Prisma's official skill) instead of, or alongside, the bundled one. |
| Agent Skills: Add Skill from GitHub Repository... | Install from any `owner/repo`, `owner/repo/path/to/skill`, or github.com URL. |
| Agent Skills: Create New Skill in Project... | Scaffold a project-specific skill from a template. |
| Agent Skills: Update Installed Skills | Refresh bundled skills when the extension ships newer versions (your edits are overwritten after confirmation). |
| Agent Skills: Remove Skill from Project | Delete a skill from all configured targets. |
| Agent Skills: Select Target Agents... | Choose which agent directories receive skills. |
| Agent Skills: Re-apply Always-on Rules and Slash Commands | Rewrites the managed instruction block and command files for all installed skills. |

### App Store review audit

`appstore-review` is recommended automatically for iOS-capable projects (native Xcode, React Native, Expo, Flutter, Capacitor). Ask the agent to "audit this app for App Store review". It inspects the whole project against Apple's App Store Review Guidelines without changing code, and writes `docs/reviews/<date>-appstore-review.md`. The report has an issue register listing every problem found, with severity, guideline, `file:line` evidence, fix, effort and status, plus checklist coverage, items to confirm manually, and App Review notes to prepare.

Click the **▶ play button** next to the skill in the Agent Skills view to start the audit directly. It installs the skill if needed, then opens a terminal running `claude` with the audit prompt (Claude Code), opens Copilot Chat in agent mode (Copilot), or copies the prompt to the clipboard (other agents). Change this with `agentSkills.runWith`.

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
| `agentSkills.enforceRules` | `true` | Write always-on rules of installed skills into the agent instruction file. |
| `agentSkills.createSlashCommands` | `true` | Generate the `/design` command file for supported agents. |
| `agentSkills.recommendOnOpen` | `true` | One-time suggestion when a project with a detectable stack has no skills yet. |
| `agentSkills.remoteSources` | Anthropic, Vercel, Superpowers, awesome-copilot, OpenAI | GitHub repositories offered in "Browse Community Skill Sources". |
| `agentSkills.githubToken` | `""` | Optional token for the GitHub API (or set `GITHUB_TOKEN`). |

## Bundled catalog

Run `Agent Skills: Add Skills to Project...` to see the full list. Categories:

- **Engineering workflows**: plan-feature, design-doc, review-pr.
- **Languages**: TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, C#, C++, Swift, Ruby, PHP, Dart, Scala, SQL, Bash.
- **Frameworks**: React, Next.js, Vue, Nuxt, Angular, Svelte/SvelteKit, React Router/Remix, Astro, React Native, Flutter, Express, NestJS, Fastify, Hono, FastAPI, Django, Flask, Spring Boot, Rails, Laravel, ASP.NET Core, Gin.
- **Libraries**: Tailwind CSS, Prisma, Drizzle, SQLAlchemy, TanStack Query, Redux Toolkit, Zustand, Zod, GraphQL, Pydantic, pandas, React Hook Form, Socket.IO, HTTP clients.
- **Tooling**: Apple App Store review audit, Docker, Kubernetes, Terraform, GitHub Actions, Vitest, Jest, pytest, Playwright, Cypress, PostgreSQL, MongoDB, Redis, ESLint/Prettier, Git workflow.

Where a community skill exists for the same topic, the catalog entry records it as a verified *upstream* source (189 entries across 66 topics, including official skills from Angular, Prisma, Laravel, Docker, HashiCorp, MongoDB, Redis, Pydantic, Flutter, Expo, Hono, Kotlin and .NET). Use **Install Community Version...** on a skill to fetch one of them from GitHub.

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
