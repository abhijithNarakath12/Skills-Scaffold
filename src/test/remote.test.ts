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
  const tree = [
    { path: 'README.md', type: 'blob' },
    { path: 'skills', type: 'tree' },
    { path: 'skills/pdf', type: 'tree' },
    { path: 'skills/pdf/SKILL.md', type: 'blob' },
    { path: 'skills/pdf/scripts', type: 'tree' },
    { path: 'skills/pdf/scripts/run.py', type: 'blob' },
    { path: 'skills/empty/notes.txt', type: 'blob' },
    { path: 'plugins/a/skills/testing/SKILL.md', type: 'blob' },
    { path: 'plugins/b/skills/testing/SKILL.md', type: 'blob' },
  ];
  const raw: Record<string, string> = {
    'skills/pdf/SKILL.md': '---\nname: pdf\ndescription: Work with PDFs\n---\n# PDF',
    'skills/pdf/scripts/run.py': 'print(1)',
    'plugins/a/skills/testing/SKILL.md': '---\nname: testing\ndescription: A\n---',
    'plugins/b/skills/testing/SKILL.md': '---\nname: testing\ndescription: B\n---',
  };
  const calls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    calls.push(url);
    let body: unknown;
    if (url === 'https://api.github.com/repos/o/r') {
      body = { default_branch: 'main' };
    } else if (url === 'https://api.github.com/repos/o/r/git/trees/main?recursive=1') {
      body = { sha: 'x', tree, truncated: false };
    } else if (url.startsWith('https://raw.githubusercontent.com/o/r/main/')) {
      body = raw[decodeURIComponent(url.slice('https://raw.githubusercontent.com/o/r/main/'.length))];
    }
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

test('lists skills under a path with two API calls, describes and downloads via raw URLs', async () => {
  const { fetcher, calls } = fakeRepo();
  const client = new GitHubClient('tok', fetcher);
  const skills = await client.listSkills({ repo: 'o/r', path: 'skills' });
  assert.deepEqual(skills.map((s) => [s.id, s.path, s.ref]), [['pdf', 'skills/pdf', 'main']]);
  assert.equal(calls.filter((c) => c.startsWith('https://api.github.com')).length, 2);
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
  // Tree and ref are cached: no further API calls were needed for describe/download.
  assert.equal(calls.filter((c) => c.startsWith('https://api.github.com')).length, 2);
});

test('lists the whole repository and disambiguates duplicate folder names', async () => {
  const { fetcher } = fakeRepo();
  const client = new GitHubClient(undefined, fetcher);
  const skills = await client.listSkills({ repo: 'o/r', ref: 'main' });
  assert.deepEqual(skills.map((s) => s.id), ['a-skills-testing', 'b-skills-testing', 'pdf']);
});

test('surfaces rate limiting clearly', async () => {
  const fetcher: Fetcher = async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) });
  const client = new GitHubClient(undefined, fetcher);
  await assert.rejects(client.listSkills({ repo: 'o/r' }), /rate limit/);
});
