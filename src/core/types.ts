/** Shape of a `skill.json` sitting next to a bundled SKILL.md, and of entries in the generated catalog. */
export interface DetectRules {
  /** npm package names (dependencies or devDependencies in any package.json). */
  npm?: string[];
  /** Python distribution names (requirements*.txt, pyproject.toml, Pipfile, environment.yml). */
  pip?: string[];
  /** Go module paths (go.mod require lines, prefix match). */
  go?: string[];
  /** Rust crate names (Cargo.toml [dependencies]). */
  cargo?: string[];
  /** Maven/Gradle coordinates, groupId or groupId:artifactId (pom.xml, build.gradle[.kts]). */
  jvm?: string[];
  /** RubyGems names (Gemfile). */
  gem?: string[];
  /** Composer package names (composer.json). */
  composer?: string[];
  /** NuGet package ids (*.csproj PackageReference). */
  nuget?: string[];
  /** Dart/Flutter pub packages (pubspec.yaml). */
  pub?: string[];
  /** Swift packages (Package.swift, Podfile). */
  swift?: string[];
  /** File names or globs (simple `*` wildcard) anywhere in the first two directory levels. */
  files?: string[];
  /** Source file extensions, e.g. ".py". Matched against a sampled scan of the workspace. */
  extensions?: string[];
}

export interface UpstreamSource {
  /** `owner/name` of a GitHub repository. */
  repo: string;
  /** Path to the skill directory inside the repository. */
  path: string;
  /** Git ref, defaults to the repository default branch. */
  ref?: string;
  /** Why this upstream is interesting. */
  note?: string;
}

export type SkillCategory = 'generic' | 'languages' | 'frameworks' | 'libraries' | 'tooling';

export interface SkillMeta {
  id: string;
  /** Human readable title, falls back to the SKILL.md frontmatter name. */
  title?: string;
  category: SkillCategory;
  tags?: string[];
  detect?: DetectRules;
  /** Community skills covering the same topic; offered as an alternative install. */
  upstream?: UpstreamSource[];
  /** Skills that should be installed together with this one. */
  recommends?: string[];
  /** Always-on instruction added to the project's agent instruction file (CLAUDE.md, AGENTS.md, ...) while the skill is installed. */
  rule?: string;
  /** Slash commands generated for agents that support project-level commands. */
  commands?: SkillCommand[];
  /** Makes the skill runnable from the extension view (play button). */
  run?: SkillRun;
}

export interface SkillRun {
  /** Button / notification label, e.g. "Run App Store audit". */
  label: string;
  /** Prompt sent to the agent. */
  prompt: string;
}

export interface SkillCommand {
  /** Command name without the slash, lowercase-hyphenated. */
  name: string;
  description: string;
  /** Prompt body. Use `$ARGUMENTS` where the user's text after the command should go. */
  prompt: string;
}

export interface CatalogEntry extends SkillMeta {
  /** Frontmatter name from SKILL.md (what the agent sees). */
  name: string;
  description: string;
  /** Directory of the skill, relative to the `skills/` root of the extension. */
  dir: string;
  /** Content hash used for update detection. */
  version: string;
}

export interface Catalog {
  generatedAt: string;
  skills: CatalogEntry[];
}

export interface Frontmatter {
  name?: string;
  description?: string;
  [key: string]: string | undefined;
}

export interface InstalledSkill {
  /** Folder name inside the target skills directory. */
  id: string;
  name: string;
  description: string;
  /** Absolute path to the skill folder. */
  path: string;
  /** Target key (claude, cursor, ...) where the folder was found. */
  target: string;
  /** Present when the skill was installed by this extension. */
  manifest?: InstallManifest;
  isSymlink: boolean;
}

export interface InstallManifest {
  installedBy: 'agent-skills-manager';
  source: { type: 'bundled'; id: string; version: string } | { type: 'github'; repo: string; path: string; ref?: string } | { type: 'local' };
  installedAt: string;
}

export const MANIFEST_FILE = '.agent-skills.json';
