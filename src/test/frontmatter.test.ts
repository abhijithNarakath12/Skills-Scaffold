import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidSkillName, parseFrontmatter } from '../core/frontmatter';

test('parses scalar frontmatter', () => {
  const { data, body } = parseFrontmatter('---\nname: react\ndescription: "Build UIs"\n---\n# React\nbody');
  assert.equal(data.name, 'react');
  assert.equal(data.description, 'Build UIs');
  assert.equal(body, '# React\nbody');
});

test('parses block scalars and skips nested mappings', () => {
  const md = `---\nname: x\ndescription: >\n  first line\n  second line\nmetadata:\n  author: me\n  version: 1\nlicense: MIT\n---\nbody`;
  const { data } = parseFrontmatter(md);
  assert.equal(data.description, 'first line second line');
  assert.equal(data.license, 'MIT');
  assert.equal(data.metadata, undefined);
});

test('handles CRLF and missing frontmatter', () => {
  assert.equal(parseFrontmatter('---\r\nname: a\r\n---\r\nhi').data.name, 'a');
  assert.deepEqual(parseFrontmatter('# no frontmatter').data, {});
});

test('validates skill names', () => {
  assert.ok(isValidSkillName('plan-feature'));
  assert.ok(isValidSkillName('c2'));
  assert.ok(!isValidSkillName('Plan Feature'));
  assert.ok(!isValidSkillName('-leading'));
  assert.ok(!isValidSkillName('double--hyphen'));
  assert.ok(!isValidSkillName('a'.repeat(65)));
});
