import * as fs from 'fs/promises';
import * as path from 'path';
import { parseFrontmatter } from './frontmatter';

export interface RemoteSource {
  repo: string;
  path?: string;
  ref?: string;
  label?: string;
}

export interface RemoteSkill {
  source: RemoteSource;
  /** Folder name = skill id. */
  id: string;
  /** Path of the skill directory inside the repository. */
  path: string;
  name?: string;
  description?: string;
}

interface GitHubContent {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  download_url: string | null;
}

export interface Fetcher {
  (url: string, init?: { headers?: Record<string, string> }): Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;
}

export class GitHubClient {
  constructor(private readonly token: string | undefined, private readonly fetchImpl: Fetcher = globalThis.fetch as Fetcher) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'User-Agent': 'agent-skills-manager', Accept: 'application/vnd.github+json' };
    if (this.token) {
      h.Authorization = `Bearer ${this.token}`;
    }
    return h;
  }

  private async contents(repo: string, repoPath: string, ref?: string): Promise<GitHubContent[]> {
    const url = `https://api.github.com/repos/${repo}/contents/${encodePath(repoPath)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
    const res = await this.fetchImpl(url, { headers: this.headers() });
    if (!res.ok) {
      if (res.status === 403) {
        throw new Error(`GitHub API rate limit reached while reading ${repo}. Set GITHUB_TOKEN or agentSkills.githubToken.`);
      }
      throw new Error(`GitHub API ${res.status} for ${repo}/${repoPath}`);
    }
    const json = (await res.json()) as GitHubContent | GitHubContent[];
    return Array.isArray(json) ? json : [json];
  }

  private async rawFile(repo: string, filePath: string, ref?: string): Promise<string> {
    const contents = await this.contents(repo, filePath, ref);
    const file = contents[0];
    if (!file || file.type !== 'file' || !file.download_url) {
      throw new Error(`Not a file: ${repo}/${filePath}`);
    }
    const res = await this.fetchImpl(file.download_url, { headers: { 'User-Agent': 'agent-skills-manager' } });
    if (!res.ok) {
      throw new Error(`Download failed (${res.status}) for ${file.download_url}`);
    }
    return res.text();
  }

  /** Lists skill folders (directories containing SKILL.md) directly under `source.path`. */
  async listSkills(source: RemoteSource): Promise<RemoteSkill[]> {
    const base = source.path ?? '';
    const entries = await this.contents(source.repo, base, source.ref);
    const dirs = entries.filter((e) => e.type === 'dir');
    const found: RemoteSkill[] = [];
    // The repo root itself might be a skill.
    if (entries.some((e) => e.type === 'file' && e.name === 'SKILL.md')) {
      found.push({ source, id: path.posix.basename(base) || source.repo.split('/')[1], path: base });
    }
    await Promise.all(
      dirs.map(async (d) => {
        try {
          const children = await this.contents(source.repo, d.path, source.ref);
          if (children.some((c) => c.type === 'file' && c.name === 'SKILL.md')) {
            found.push({ source, id: d.name, path: d.path });
          }
        } catch {
          // skip unreadable dirs
        }
      }),
    );
    return found.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Reads name/description from a remote SKILL.md. */
  async describe(skill: RemoteSkill): Promise<RemoteSkill> {
    const text = await this.rawFile(skill.source.repo, path.posix.join(skill.path, 'SKILL.md'), skill.source.ref);
    const fm = parseFrontmatter(text).data;
    return { ...skill, name: fm.name, description: fm.description };
  }

  /** Downloads a whole skill directory into `dest` (recursively). */
  async download(skill: RemoteSkill, dest: string, onFile?: (file: string) => void): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await this.contents(skill.source.repo, skill.path, skill.source.ref);
    for (const entry of entries) {
      const target = path.join(dest, entry.name);
      if (entry.type === 'dir') {
        await this.download({ ...skill, path: entry.path }, target, onFile);
      } else if (entry.type === 'file' && entry.download_url) {
        const res = await this.fetchImpl(entry.download_url, { headers: { 'User-Agent': 'agent-skills-manager' } });
        if (!res.ok) {
          throw new Error(`Download failed (${res.status}) for ${entry.path}`);
        }
        await fs.writeFile(target, Buffer.from(await res.arrayBuffer()));
        onFile?.(entry.path);
      }
    }
  }
}

function encodePath(p: string): string {
  return p.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

/** Parses user input like `owner/repo`, `owner/repo/path/to/skill`, or a GitHub URL (tree/blob links supported). */
export function parseGitHubReference(input: string): RemoteSource | undefined {
  const trimmed = input.trim();
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)(?:\/(?:tree|blob)\/([^/\s]+)(?:\/([^\s#?]*))?)?/.exec(trimmed);
  if (url) {
    const repo = `${url[1]}/${url[2].replace(/\.git$/, '')}`;
    const ref = url[3];
    let p = url[4] ?? '';
    if (p.endsWith('/SKILL.md')) {
      p = p.slice(0, -'/SKILL.md'.length);
    }
    return { repo, ref, path: p || undefined };
  }
  const short = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:@([^/\s]+))?(?:\/(.+))?$/.exec(trimmed);
  if (short) {
    return { repo: `${short[1]}/${short[2]}`, ref: short[3], path: short[4] };
  }
  return undefined;
}
