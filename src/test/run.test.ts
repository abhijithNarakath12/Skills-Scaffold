import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claudeCommand, resolveRunMode } from '../core/run';

test('resolveRunMode follows setting, then primary target', () => {
  assert.equal(resolveRunMode('auto', 'claude'), 'claude-terminal');
  assert.equal(resolveRunMode('auto', 'copilot'), 'copilot-chat');
  assert.equal(resolveRunMode('auto', 'cursor'), 'clipboard');
  assert.equal(resolveRunMode('clipboard', 'claude'), 'clipboard');
  assert.equal(resolveRunMode('copilot-chat', 'claude'), 'copilot-chat');
});

test('claudeCommand quotes the prompt safely', () => {
  assert.equal(claudeCommand("audit the user's app\n now", 'darwin'), `claude 'audit the user'\\''s app now'`);
  assert.equal(claudeCommand('say "hi"', 'win32'), 'claude "say \\"hi\\""');
});
