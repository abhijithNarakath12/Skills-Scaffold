# Changelog

## 0.1.0

- Initial release.
- Bundled skill catalog: languages, frameworks, libraries, tooling, and three engineering workflow skills (`plan-feature`, `design-doc`, `review-pr`).
- Project stack detection (npm, pip, Go, Cargo, Maven/Gradle, RubyGems, Composer, NuGet, pub, SwiftPM) with recommendations.
- Install to one or more agent directories (`.claude/skills`, `.agents/skills`, `.cursor/skills`, `.github/skills`, `.gemini/skills`, `.windsurf/skills`, `.opencode/skills`, custom), linking secondary targets to the primary copy.
- Browse and install community skills from GitHub repositories (Anthropic, Vercel, Superpowers, or any `owner/repo`).
- Create new project-local skills from a template; update bundled skills when the extension ships newer versions.
