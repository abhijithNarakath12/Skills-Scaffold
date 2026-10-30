import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { BLOCK_BEGIN, BLOCK_END, applySkillIntegration, commandFilesFor, instructionFileFor, readManagedRules, removeSkillIntegration, upsertRule, withManagedRules } from '../core/integration';
import { resolveTargets } from '../core/targets';
import type { CatalogEntry } from '../core/types';

const planEntry: CatalogEntry = {
  id: 'plan-feature', name: 'plan-feature', description: 'd', category: 'generic', dir: 'generic/plan-feature', version: '1',
  rule: 'Plan mode is always on. Wait for approval before editing files.',
  commands: [{ name: 'plan', description: 'Write a plan', prompt: 'Use plan-feature for: $ARGUMENTS' }],
};
const designEntry: CatalogEntry = {
  id: 'design-doc', name: 'design-doc', description: 'd', category: 'generic', dir: 'generic/design-doc', version: '1',
  commands: [{ name: 'design', description: 'Design doc', prompt: 'Use design-doc for: $ARGUMENTS' }],
};

test('managed block is inserted, updated and removed without touching surrounding text', () => {
  const original = '# My project\n\nSome notes.\n';
  const withOne = withManagedRules(original, [{ id: 'plan-feature', text: 'Always plan.' }]);
  assert.ok(withOne.startsWith('# My project\n\nSome notes.\n\n' + BLOCK_BEGIN));
  assert.ok(withOne.trimEnd().endsWith(BLOCK_END));
  assert.deepEqual(readManagedRules(withOne), [{ id: 'plan-feature', text: 'Always plan.' }]);

  const rules = upsertRule(readManagedRules(withOne), { id: 'design-doc', text: 'Design first.' });
  const withTwo = withManagedRules(withOne + '\nTrailing section.\n', rules);
  assert.deepEqual(readManagedRules(withTwo).map((r) => r.id), ['design-doc', 'plan-feature']);
  assert.ok(withTwo.endsWith(BLOCK_END + '\n\nTrailing section.\n'));
  assert.equal((withTwo.match(new RegExp(BLOCK_BEGIN, 'g')) ?? []).length, 1);

  const updated = withManagedRules(withTwo, upsertRule(rules, { id: 'plan-feature', text: 'Changed.' }));
  assert.equal(readManagedRules(updated).find((r) => r.id === 'plan-feature')?.text, 'Changed.');

  const emptied = withManagedRules(updated, []);
  assert.equal(emptied, '# My project\n\nSome notes.\n\nTrailing section.\n');
  assert.equal(withManagedRules('', []), '');
  assert.ok(withManagedRules('', [{ id: 'x', text: 'y' }], '---\nalwaysApply: true\n---\n').startsWith('---\nalwaysApply: true\n---\n\n' + BLOCK_BEGIN));
});

test('instruction files and command files per target', () => {
  const targets = resolveTargets(['claude', 'cursor', 'copilot', 'gemini', 'windsurf', 'opencode', 'codex'], '');
  assert.deepEqual(targets.map((t) => instructionFileFor(t).path), ['CLAUDE.md', '.cursor/rules/agent-skills.mdc', '.github/copilot-instructions.md', 'GEMINI.md', '.windsurf/rules/agent-skills.md', 'AGENTS.md', 'AGENTS.md']);
  const cmd = planEntry.commands![0];
  assert.deepEqual(targets.map((t) => commandFilesFor(t, 'plan-feature', cmd).map((c) => c.path)), [
    ['.claude/commands/plan.md'], ['.cursor/commands/plan.md'], ['.github/prompts/plan.prompt.md'], ['.gemini/commands/plan.toml'], ['.windsurf/workflows/plan.md'], ['.opencode/command/plan.md'], [],
  ]);
  const claude = commandFilesFor(targets[0], 'plan-feature', cmd)[0].content;
  assert.match(claude, /^---\ndescription: Write a plan\n/);
  assert.match(claude, /\$ARGUMENTS/);
  const gemini = commandFilesFor(targets[3], 'plan-feature', cmd)[0].content;
  assert.match(gemini, /\{\{args\}\}/);
  assert.doesNotMatch(gemini, /\$ARGUMENTS/);
});

test('apply and remove integration end to end', async () => {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'integ-'));
  try {
    await fs.writeFile(path.join(ws, 'CLAUDE.md'), '# Project\n\nUse pnpm.\n');
    await fs.mkdir(path.join(ws, '.claude/commands'), { recursive: true });
    await fs.writeFile(path.join(ws, '.claude/commands/design.md'), 'my own design command');
    const targets = resolveTargets(['claude', 'cursor'], '');
    const r1 = await applySkillIntegration(ws, targets, planEntry, { rules: true, commands: true });
    assert.deepEqual(r1.instructionFiles, ['CLAUDE.md', '.cursor/rules/agent-skills.mdc']);
    assert.deepEqual(r1.commandFiles, ['.claude/commands/plan.md', '.cursor/commands/plan.md']);
    const claudeMd = await fs.readFile(path.join(ws, 'CLAUDE.md'), 'utf8');
    assert.ok(claudeMd.startsWith('# Project\n\nUse pnpm.\n\n' + BLOCK_BEGIN));
    assert.match(claudeMd, /\*\*plan-feature\*\*: Plan mode is always on/);
    const mdc = await fs.readFile(path.join(ws, '.cursor/rules/agent-skills.mdc'), 'utf8');
    assert.ok(mdc.startsWith('---\ndescription: Rules for installed agent skills\nalwaysApply: true\n---\n'));

    const r2 = await applySkillIntegration(ws, targets, designEntry, { rules: true, commands: true });
    assert.deepEqual(r2.instructionFiles, []);
    assert.deepEqual(r2.commandFiles, ['.cursor/commands/design.md'], 'user-authored claude command must not be overwritten');
    assert.equal(await fs.readFile(path.join(ws, '.claude/commands/design.md'), 'utf8'), 'my own design command');

    await applySkillIntegration(ws, targets, planEntry, { rules: false, commands: false });
    assert.equal((await fs.readFile(path.join(ws, 'CLAUDE.md'), 'utf8')).split(BLOCK_BEGIN).length, 2, 'idempotent');

    const removed = await removeSkillIntegration(ws, targets, planEntry);
    assert.deepEqual(removed.instructionFiles, ['CLAUDE.md', '.cursor/rules/agent-skills.mdc']);
    assert.deepEqual(removed.commandFiles, ['.claude/commands/plan.md', '.cursor/commands/plan.md']);
    assert.equal(await fs.readFile(path.join(ws, 'CLAUDE.md'), 'utf8'), '# Project\n\nUse pnpm.\n');
    await assert.rejects(fs.stat(path.join(ws, '.cursor/rules/agent-skills.mdc')), 'empty managed rules file is deleted');
    await assert.rejects(fs.stat(path.join(ws, '.claude/commands/plan.md')));
    assert.equal(await fs.readFile(path.join(ws, '.claude/commands/design.md'), 'utf8'), 'my own design command');
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});
