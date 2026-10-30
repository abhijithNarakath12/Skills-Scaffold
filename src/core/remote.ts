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
  /** Folder name = skill id (made unique when a repo has several folders with the same name). */
  id: string;
  /** Path of the skill directory inside the repository ('' when SKILL.md sits at the repo root). */
  path: string;
  /** Resolved git ref the listing was taken from. */
  ref: string;
  name?: string;
  description?: string;
}

interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  size?: number;
}

interface TreeResponse {
  sha: string;
  tree: TreeEntry[];
  truncated: boolean;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type Fetcher = (url: string, init?: { headers?: Record<string, string> }) => Promise<FetchResponse>;

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

/**
 * Reads skills from GitHub with as few API calls as possible:
 * one call to resolve the default branch (skipped when a ref is given), one call for the
 * recursive git tree, and raw.githubusercontent.com downloads (not rate limited like the API).
 */
export class GitHubClient {
  private readonly treeCache = new Map<string, Promise<TreeResponse>>();
  private readonly refCache = new Map<string, Promise<string>>();

  constructor(private readonly token: string | undefined, private readonly fetchImpl: Fetcher = globalThis.fetch as Fetcher) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'User-Agent': 'agent-skills-manager', Accept: 'application/vnd.github+json' };
    if (this.token) {
      h.Authorization = `Bearer ${this.token}`;
    }
    return h;
  }

  private async api<T>(route: string): Promise<T> {
    const res = await this.fetchImpl(`${API}${route}`, { headers: this.headers() });
    if (!res.ok) {
      if (res.status === 403 || res.status === 429) {
        throw new Error('GitHub API rate limit reached. Set GITHUB_TOKEN (or agentSkills.githubToken) to raise it.');
      }
      if (res.status === 404) {
        throw new Error(`Not found on GitHub: ${route}`);
      }
      throw new Error(`GitHub API error ${res.status} for ${route}`);
    }
    return (await res.json()) as T;
  }

  /** Default branch of a repository, cached. */
  resolveRef(repo: string, ref?: string): Promise<string> {
    if (ref) {
      return Promise.resolve(ref);
    }
    let p = this.refCache.get(repo);
    if (!p) {
      p = this.api<{ default_branch: string }>(`/repos/${repo}`).then((r) => r.default_branch);
      this.refCache.set(repo, p);
    }
    return p;
  }

  private tree(repo: string, ref: string): Promise<TreeResponse> {
    const key = `${repo}@${ref}`;
    let p = this.treeCache.get(key);
    if (!p) {
      p = this.api<TreeResponse>(`/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
      this.treeCache.set(key, p);
    }
    return p;
  }

  private async raw(repo: string, ref: string, filePath: string): Promise<FetchResponse> {
    const url = `${RAW}/${repo}/${encodeURIComponent(ref)}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
    const res = await this.fetchImpl(url, { headers: { 'User-Agent': 'agent-skills-manager' } });
    if (!res.ok) {
      throw new Error(`Download failed (${res.status}) for ${repo}/${filePath}`);
    }
    return res;
  }

  /** Lists every folder containing a SKILL.md at or below `source.path`. */
  async listSkills(source: RemoteSource): Promise<RemoteSkill[]> {
    const ref = await this.resolveRef(source.repo, source.ref);
    const tree = await this.tree(source.repo, ref);
    const base = normalizePath(source.path);
    const prefix = base ? base + '/' : '';
    const skillFiles = tree.tree.filter((e) => e.type === 'blob' && (e.path === 'SKILL.md' || e.path.endsWith('/SKILL.md')) && (!base || e.path === `${base}/SKILL.md` || e.path.startsWith(prefix)));
    const found: RemoteSkill[] = skillFiles.map((e) => {
      const dir = e.path === 'SKILL.md' ? '' : e.path.slice(0, -'/SKILL.md'.length);
      return { source, id: dir ? path.posix.basename(dir) : source.repo.split('/')[1], path: dir, ref };
    });
    disambiguate(found);
    if (tree.truncated && !found.length) {
      throw new Error(`${source.repo} is too large to list in one request; point the source at a sub-folder.`);
    }
    return found.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Reads name/description from a remote SKILL.md. */
  async describe(skill: RemoteSkill): Promise<RemoteSkill> {
    const res = await this.raw(skill.source.repo, skill.ref, path.posix.join(skill.path, 'SKILL.md'));
    const fm = parseFrontmatter(await res.text()).data;
    return { ...skill, name: fm.name, description: fm.description };
  }

  /** Downloads a whole skill directory into `dest`. */
  async download(skill: RemoteSkill, dest: string, onFile?: (file: string) => void): Promise<void> {
    const tree = await this.tree(skill.source.repo, skill.ref);
    const prefix = skill.path ? skill.path + '/' : '';
    const files = tree.tree.filter((e) => e.type === 'blob' && e.path.startsWith(prefix) && (prefix || !e.path.includes('/') || true));
    if (!files.length) {
      throw new Error(`No files found for ${skill.source.repo}/${skill.path}`);
    }
    await fs.mkdir(dest, { recursive: true });
    for (const file of files) {
      const rel = file.path.slice(prefix.length);
      if (rel.includes('..')) {
        continue; // never write outside dest
      }
      const target = path.join(dest, ...rel.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      const res = await this.raw(skill.source.repo, skill.ref, file.path);
      await fs.writeFile(target, Buffer.from(await res.arrayBuffer()));
      onFile?.(file.path);
    }
  }
}

/** Gives duplicate folder names (e.g. plugins/a/skills/testing and plugins/b/skills/testing) unique ids using the shortest distinguishing path suffix. */
function disambiguate(skills: RemoteSkill[]): void {
  const groups = new Map<string, RemoteSkill[]>();
  for (const s of skills) {
    groups.set(s.id, [...(groups.get(s.id) ?? []), s]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }
    const maxDepth = Math.max(...group.map((s) => s.path.split('/').length));
    for (let k = 2; k <= maxDepth; k++) {
      const ids = group.map((s) => s.path.split('/').slice(-k).join('-').replace(/[^a-z0-9-]/gi, '-').toLowerCase());
      if (new Set(ids).size === group.length) {
        group.forEach((s, i) => (s.id = ids[i]));
        break;
      }
    }
  }
}

function normalizePath(p: string | undefined): string {
  return (p ?? '').replace(/^\/+|\/+$/g, '');
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
