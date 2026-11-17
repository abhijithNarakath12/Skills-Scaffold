# Changelog

## Unreleased

- `skill-creator-plus` skill (vendored from robonuggets/skill-creator-plus, MIT): audits, creates and refines skills, with a bundled validator.
- All bundled skills now pass that validator with no errors. Six skills (astro, flutter, react-native, remix-react-router, svelte, git-workflow) had descriptions that did not parse as YAML, so Claude Code could load them without a name or description. Also: added "Use when" triggers to seven library descriptions, contents lists to long reference files, and a go-back step to `plan-feature`, and removed an XML tag and some time-sensitive wording.
- Generated slash-command files and new-skill templates now quote `description`, so a description containing `: ` no longer breaks their frontmatter.

## 0.1.0

- Initial release.
- Bundled skill catalog: languages, frameworks, libraries, tooling, and three engineering workflow skills (`plan-feature`, `design-doc`, `review-pr`).
- Project stack detection (npm, pip, Go, Cargo, Maven/Gradle, RubyGems, Composer, NuGet, pub, SwiftPM) with recommendations.
- Install to one or more agent directories (`.claude/skills`, `.agents/skills`, `.cursor/skills`, `.github/skills`, `.gemini/skills`, `.windsurf/skills`, `.opencode/skills`, custom), linking secondary targets to the primary copy.
- Browse and install community skills from GitHub repositories (Anthropic, Vercel, Superpowers, or any `owner/repo`).
- Always-on rules written to the agent instruction file (`plan-feature` is enforced on every task) and a generated `/design` slash command for Claude Code, Cursor, Copilot, Gemini CLI, Windsurf and OpenCode.
- `appstore-review` skill: whole-project Apple App Store audit that writes a report document with every issue found.
- Create new project-local skills from a template; update bundled skills when the extension ships newer versions.
