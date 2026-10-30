export interface TargetInfo {
  key: string;
  label: string;
  /** Workspace-relative directory holding skill folders. */
  dir: string;
}

export const TARGETS: Record<string, TargetInfo> = {
  claude: { key: 'claude', label: 'Claude Code', dir: '.claude/skills' },
  universal: { key: 'universal', label: 'Universal (.agents)', dir: '.agents/skills' },
  codex: { key: 'codex', label: 'OpenAI Codex', dir: '.agents/skills' },
  cursor: { key: 'cursor', label: 'Cursor', dir: '.cursor/skills' },
  copilot: { key: 'copilot', label: 'GitHub Copilot', dir: '.github/skills' },
  gemini: { key: 'gemini', label: 'Gemini CLI', dir: '.gemini/skills' },
  windsurf: { key: 'windsurf', label: 'Windsurf', dir: '.windsurf/skills' },
  opencode: { key: 'opencode', label: 'OpenCode', dir: '.opencode/skills' },
};

/** Resolves configured target keys to unique directories, keeping order (first = primary). */
export function resolveTargets(keys: string[], customDir: string): TargetInfo[] {
  const seen = new Set<string>();
  const out: TargetInfo[] = [];
  for (const key of keys.length ? keys : ['claude']) {
    const info =
      key === 'custom'
        ? { key: 'custom', label: 'Custom directory', dir: normalizeRelative(customDir || '.agent-skills') }
        : TARGETS[key];
    if (!info || seen.has(info.dir)) {
      continue;
    }
    seen.add(info.dir);
    out.push(info);
  }
  return out;
}

function normalizeRelative(dir: string): string {
  return dir.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
}
