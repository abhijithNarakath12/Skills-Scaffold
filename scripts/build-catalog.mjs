// Generates skills/catalog.json from every skills/<category>/<id>/{skill.json,SKILL.md}.
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');
const CATEGORIES = ['generic', 'languages', 'frameworks', 'libraries', 'tooling'];

function parseFrontmatter(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  const data = {};
  if (!m) return data;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^[|>]-?$/.test(value)) {
      const buf = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) buf.push(lines[++i].trim());
      value = value.startsWith('>') ? buf.join(' ') : buf.join('\n');
    } else if (/^(["']).*\1$/.test(value)) {
      value = value.slice(1, -1);
    }
    data[kv[1]] = value;
  }
  return data;
}

async function hashDir(dir) {
  const hash = createHash('sha256');
  async function walk(d) {
    const entries = (await readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name === 'skill.json' || e.name === '.DS_Store') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) {
        hash.update(path.relative(dir, p));
        hash.update(await readFile(p));
      }
    }
  }
  await walk(dir);
  return hash.digest('hex').slice(0, 12);
}

const skills = [];
const errors = [];
for (const category of CATEGORIES) {
  const catDir = path.join(root, category);
  let ids;
  try {
    ids = (await readdir(catDir)).filter((n) => !n.startsWith('.'));
  } catch {
    continue;
  }
  for (const id of ids) {
    const dir = path.join(catDir, id);
    if (!(await stat(dir)).isDirectory()) continue;
    let meta = {};
    try {
      meta = JSON.parse(await readFile(path.join(dir, 'skill.json'), 'utf8'));
    } catch {
      errors.push(`${category}/${id}: missing or invalid skill.json`);
      continue;
    }
    let fm;
    try {
      fm = parseFrontmatter(await readFile(path.join(dir, 'SKILL.md'), 'utf8'));
    } catch {
      errors.push(`${category}/${id}: missing SKILL.md`);
      continue;
    }
    if (!fm.name || !fm.description) {
      errors.push(`${category}/${id}: SKILL.md frontmatter needs name and description`);
      continue;
    }
    if (fm.name !== id) {
      errors.push(`${category}/${id}: frontmatter name "${fm.name}" must equal folder name`);
    }
    skills.push({
      id,
      name: fm.name,
      title: meta.title,
      description: fm.description,
      category,
      tags: meta.tags ?? [],
      detect: meta.detect,
      upstream: meta.upstream,
      recommends: meta.recommends,
      dir: `${category}/${id}`,
      version: await hashDir(dir),
    });
  }
}
if (errors.length) {
  console.error('Catalog build failed:\n - ' + errors.join('\n - '));
  process.exit(1);
}
skills.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.id.localeCompare(b.id));
await writeFile(path.join(root, 'catalog.json'), JSON.stringify({ generatedAt: new Date().toISOString(), skills }, null, 2) + '\n');
console.log(`catalog.json: ${skills.length} skills`);
