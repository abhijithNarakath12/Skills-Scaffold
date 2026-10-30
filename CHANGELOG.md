# Changelog

## 0.1.0

- Initial release.
- Bundled skill catalog: languages, frameworks, libraries, tooling, and three engineering workflow skills (`plan-feature`, `design-doc`, `review-pr`).
- Project stack detection (npm, pip, Go, Cargo, Maven/Gradle, RubyGems, Composer, NuGet, pub, SwiftPM) with recommendations.
- Install to one or more agent directories (`.claude/skills`, `.agents/skills`, `.cursor/skills`, `.github/skills`, `.gemini/skills`, `.windsurf/skills`, `.opencode/skills`, custom), linking secondary targets to the primary copy.
- Browse and install community skills from GitHub repositories (Anthropic, Vercel, Superpowers, or any `owner/repo`).
- Always-on rules written to the agent instruction file (`plan-feature` is enforced on every task) and a generated `/design` slash command for Claude Code, Cursor, Copilot, Gemini CLI, Windsurf and OpenCode.
- `appstore-review` skill: whole-project Apple App Store audit that writes a report document with every issue found.
- Create new project-local skills from a template; update bundled skills when the extension ships newer versions.
