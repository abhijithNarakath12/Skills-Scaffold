import type { Frontmatter } from './types';

/**
 * Minimal YAML frontmatter reader for SKILL.md files.
 * Supports top-level `key: value` scalars (quoted or plain) and block scalars (`|` / `>`).
 * Nested objects are ignored, which is fine: the Agent Skills spec only requires
 * `name` and `description` as scalars.
 */
export function parseFrontmatter(markdown: string): { data: Frontmatter; body: string } {
  const normalized = markdown.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { data: {}, body: normalized };
  }
  const end = normalized.indexOf('\n---', 4);
  if (end === -1) {
    return { data: {}, body: normalized };
  }
  const block = normalized.slice(4, end);
  const body = normalized.slice(end + 4).replace(/^\n/, '');
  const data: Frontmatter = {};
  const lines = block.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!m) {
      continue;
    }
    const key = m[1];
    let value = m[2].trim();
    if (value === '|' || value === '>' || value === '|-' || value === '>-') {
      const folded = value.startsWith('>');
      const collected: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
        collected.push(lines[++i].replace(/^\s{1,}/, ''));
      }
      value = folded ? collected.join(' ').trim() : collected.join('\n').trim();
    } else if (value === '') {
      // nested mapping or empty; skip nested lines
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        i++;
      }
      continue;
    } else {
      value = unquote(value);
    }
    data[key] = value;
  }
  return { data, body };
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    const inner = value.slice(1, -1);
    return value.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\n/g, '\n') : inner.replace(/''/g, "'");
  }
  return value;
}

/** Validates a skill name against the Agent Skills spec (lowercase, digits and hyphens, 1-64 chars). */
export function isValidSkillName(name: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) && name.length <= 64;
}
