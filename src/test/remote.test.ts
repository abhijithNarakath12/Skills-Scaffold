import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { GitHubClient, parseGitHubReference, type Fetcher } from '../core/remote';

test('parseGitHubReference accepts short forms and URLs', () => {
  assert.deepEqual(parseGitHubReference('anthropics/skills'), { repo: 'anthropics/skills', ref: undefined, path: undefined });
  assert.deepEqual(parseGitHubReference('vercel-labs/agent-skills/skills/react-best-practices'), { repo: 'vercel-labs/agent-skills', ref: undefined, path: 'skills/react-best-practices' });
  assert.deepEqual(parseGitHubReference('owner/repo@v1/skills/x'), { repo: 'owner/repo', ref: 'v1', path: 'skills/x' });
  assert.deepEqual(parseGitHubReference('https://github.com/anthropics/skills/tree/main/skills/pdf'), { repo: 'anthropics/skills', ref: 'main', path: 'skills/pdf' });
  assert.deepEqual(parseGitHubReference('https://github.com/a/b/blob/main/skills/pdf/SKILL.md'), { repo: 'a/b', ref: 'main', path: 'skills/pdf' });
  assert.deepEqual(parseGitHubReference('https://github.com/a/b.git'), { repo: 'a/b', ref: undefined, path: undefined });
  assert.equal(parseGitHubReference('not a repo'), undefined);
});

function fakeRepo(): { fetcher: Fetcher; calls: string[] } {
  const tree: Record<string, unknown> = {
    'skills': [
      { name: 'pdf', path: 'skills/pdf', type: 'dir', download_url: null },
      { name: 'README.md', path: 'skills/README.md', type: 'file', download_url: 'raw://skills/README.md' },
      { name: 'empty', path: 'skills/empty', type: 'dir', download_url: null },
    ],
    'skills/pdf': [
      { name: 'SKILL.md', path: 'skills/pdf/SKILL.md', type: 'file', download_url: 'raw://skills/pdf/SKILL.md' },
      { name: 'scripts', path: 'skills/pdf/scripts', type: 'dir', download_url: null },
    ],
    'skills/pdf/SKILL.md': { name: 'SKILL.md', path: 'skills/pdf/SKILL.md', type: 'file', download_url: 'raw://skills/pdf/SKILL.md' },
    'skills/pdf/scripts': [{ name: 'run.py', path: 'skills/pdf/scripts/run.py', type: 'file', download_url: 'raw://skills/pdf/scripts/run.py' }],
    'skills/empty': [{ name: 'notes.txt', path: 'skills/empty/notes.txt', type: 'file', download_url: 'raw://x' }],
  };
  const raw: Record<string, string> = {
    'raw://skills/pdf/SKILL.md': '---\nname: pdf\ndescription: Work with PDFs\n---\n# PDF',
    'raw://skills/pdf/scripts/run.py': 'print(1)',
  };
  const calls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    calls.push(url);
    const api = /api\.github\.com\/repos\/o\/r\/contents\/(.*?)(?:\?.*)?$/.exec(url);
    const body = api ? tree[decodeURIComponent(api[1])] : raw[url];
    const ok = body !== undefined;
    return {
      ok,
      status: ok ? 200 : 404,
      json: async () => body,
      text: async () => String(body),
      arrayBuffer: async () => new TextEncoder().encode(String(body)).buffer as ArrayBuffer,
    };
  };
  return { fetcher, calls };
}

test('lists, describes and downloads remote skills', async () => {
  const { fetcher, calls } = fakeRepo();
  const client = new GitHubClient('tok', fetcher);
  const skills = await client.listSkills({ repo: 'o/r', path: 'skills', ref: 'main' });
  assert.deepEqual(skills.map((s) => s.id), ['pdf']);
  assert.ok(calls[0].includes('?ref=main'));
  const described = await client.describe(skills[0]);
  assert.equal(described.name, 'pdf');
  assert.equal(described.description, 'Work with PDFs');
  const dest = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-'));
  try {
    await client.download(skills[0], dest);
    assert.equal(await fs.readFile(path.join(dest, 'scripts/run.py'), 'utf8'), 'print(1)');
    assert.match(await fs.readFile(path.join(dest, 'SKILL.md'), 'utf8'), /name: pdf/);
  } finally {
    await fs.rm(dest, { recursive: true, force: true });
  }
});

test('surfaces rate limiting clearly', async () => {
  const fetcher: Fetcher = async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) });
  const client = new GitHubClient(undefined, fetcher);
  await assert.rejects(client.listSkills({ repo: 'o/r' }), /rate limit/);
});
