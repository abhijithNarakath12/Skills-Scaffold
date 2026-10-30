import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, test } from 'node:test';
import { installSkillDir, listInstalled, removeSkill } from '../core/installer';
import { resolveTargets } from '../core/targets';
import { MANIFEST_FILE, type InstallManifest } from '../core/types';

let root: string;
let source: string;
const manifest: InstallManifest = { installedBy: 'agent-skills-manager', source: { type: 'bundled', id: 'demo', version: 'abc' }, installedAt: '2025-01-01T00:00:00Z' };

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'install-'));
  source = path.join(root, 'source', 'demo');
  await fs.mkdir(path.join(source, 'references'), { recursive: true });
  await fs.writeFile(path.join(source, 'SKILL.md'), '---\nname: demo\ndescription: Demo skill\n---\nbody');
  await fs.writeFile(path.join(source, 'references', 'a.md'), 'ref');
  await fs.writeFile(path.join(source, 'skill.json'), '{}');
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test('installs a copy into the primary target and links secondary targets', async () => {
  const ws = path.join(root, 'ws1');
  await fs.mkdir(ws);
  const targets = resolveTargets(['claude', 'cursor', 'codex', 'universal'], '');
  assert.deepEqual(targets.map((t) => t.dir), ['.claude/skills', '.cursor/skills', '.agents/skills']);
  const result = await installSkillDir(source, 'demo', manifest, { workspaceRoot: ws, targets, linkSecondary: true });
  assert.equal(result.skipped, undefined);
  assert.equal(result.paths.length, 3);
  const primary = path.join(ws, '.claude/skills/demo');
  assert.equal(await fs.readFile(path.join(primary, 'references/a.md'), 'utf8'), 'ref');
  await assert.rejects(fs.stat(path.join(primary, 'skill.json')), 'skill.json must not be copied');
  const saved = JSON.parse(await fs.readFile(path.join(primary, MANIFEST_FILE), 'utf8'));
  assert.equal(saved.source.id, 'demo');
  const link = path.join(ws, '.cursor/skills/demo');
  assert.ok((await fs.lstat(link)).isSymbolicLink());
  assert.equal(await fs.readlink(link), path.join('..', '..', '.claude', 'skills', 'demo'));
  assert.equal(await fs.readFile(path.join(link, 'SKILL.md'), 'utf8'), '---\nname: demo\ndescription: Demo skill\n---\nbody');

  const again = await installSkillDir(source, 'demo', manifest, { workspaceRoot: ws, targets, linkSecondary: true });
  assert.equal(again.skipped, 'exists');

  const installed = await listInstalled(ws, targets);
  assert.deepEqual(installed.map((s) => [s.target, s.isSymlink]), [['claude', false], ['cursor', true], ['codex', true]]);
  assert.equal(installed[0].name, 'demo');
  assert.equal(installed[0].manifest?.source.type, 'bundled');

  const removed = await removeSkill(ws, targets, 'demo');
  assert.equal(removed.length, 3);
  assert.deepEqual(await listInstalled(ws, targets), []);
});

test('copies to secondary targets when linking is disabled and overwrites on request', async () => {
  const ws = path.join(root, 'ws2');
  await fs.mkdir(ws);
  const targets = resolveTargets(['custom', 'copilot'], 'tools/skills/');
  assert.equal(targets[0].dir, 'tools/skills');
  await installSkillDir(source, 'demo', manifest, { workspaceRoot: ws, targets, linkSecondary: false });
  const copy = path.join(ws, '.github/skills/demo');
  assert.ok(!(await fs.lstat(copy)).isSymbolicLink());
  await fs.writeFile(path.join(ws, 'tools/skills/demo/SKILL.md'), 'edited');
  const result = await installSkillDir(source, 'demo', manifest, { workspaceRoot: ws, targets, linkSecondary: false, overwrite: true });
  assert.equal(result.skipped, undefined);
  assert.match(await fs.readFile(path.join(ws, 'tools/skills/demo/SKILL.md'), 'utf8'), /name: demo/);
});

test('listInstalled ignores folders without SKILL.md and reports custom skills', async () => {
  const ws = path.join(root, 'ws3');
  const targets = resolveTargets(['claude'], '');
  await fs.mkdir(path.join(ws, '.claude/skills/not-a-skill'), { recursive: true });
  await fs.mkdir(path.join(ws, '.claude/skills/handwritten'), { recursive: true });
  await fs.writeFile(path.join(ws, '.claude/skills/handwritten/SKILL.md'), '---\nname: handwritten\ndescription: Mine\n---\n');
  const installed = await listInstalled(ws, targets);
  assert.deepEqual(installed.map((s) => s.id), ['handwritten']);
  assert.equal(installed[0].manifest, undefined);
});
