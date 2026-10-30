// Validates every bundled skill against the Agent Skills spec basics and this repo's conventions.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');
const CATEGORIES = ['generic', 'languages', 'frameworks', 'libraries', 'tooling'];
const DETECT_KEYS = ['npm', 'pip', 'go', 'cargo', 'jvm', 'gem', 'composer', 'nuget', 'pub', 'swift', 'files', 'extensions'];
const problems = [];
const ids = new Set();

for (const category of CATEGORIES) {
  let names = [];
  try {
    names = (await readdir(path.join(root, category))).filter((n) => !n.startsWith('.'));
  } catch {
    continue;
  }
  for (const id of names) {
    const dir = path.join(root, category, id);
    if (!(await stat(dir)).isDirectory()) continue;
    const where = `${category}/${id}`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) || id.length > 64) problems.push(`${where}: folder name must be lowercase-hyphenated, max 64 chars`);
    if (ids.has(id)) problems.push(`${where}: duplicate skill id`);
    ids.add(id);
    let md;
    try {
      md = await readFile(path.join(dir, 'SKILL.md'), 'utf8');
    } catch {
      problems.push(`${where}: SKILL.md missing`);
      continue;
    }
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
    if (!fm) {
      problems.push(`${where}: SKILL.md has no frontmatter`);
      continue;
    }
    const name = /^name:\s*(.+)$/m.exec(fm[1])?.[1]?.trim().replace(/^["']|["']$/g, '');
    const descLine = /^description:\s*(.*)$/m.exec(fm[1])?.[1]?.trim();
    if (name !== id) problems.push(`${where}: frontmatter name (${name}) must equal folder name`);
    if (!descLine) problems.push(`${where}: description missing`);
    else if (!/^[|>]/.test(descLine) && descLine.replace(/^["']|["']$/g, '').length < 40) problems.push(`${where}: description too short to be useful for triggering (<40 chars)`);
    if (descLine && descLine.length > 1024) problems.push(`${where}: description longer than 1024 chars`);
    const body = md.slice(fm[0].length);
    if (body.trim().length < 400) problems.push(`${where}: SKILL.md body is very short (<400 chars)`);
    if (body.length > 60000) problems.push(`${where}: SKILL.md body is huge (>60k chars); move material into references/`);
    // referenced files must exist
    for (const m of body.matchAll(/\]\(((?:references|scripts|assets)\/[^)\s#]+)\)/g)) {
      try {
        await stat(path.join(dir, m[1]));
      } catch {
        problems.push(`${where}: link to missing file ${m[1]}`);
      }
    }
    let meta;
    try {
      meta = JSON.parse(await readFile(path.join(dir, 'skill.json'), 'utf8'));
    } catch {
      problems.push(`${where}: skill.json missing or invalid`);
      continue;
    }
    if (meta.detect) {
      for (const k of Object.keys(meta.detect)) {
        if (!DETECT_KEYS.includes(k)) problems.push(`${where}: unknown detect key "${k}"`);
      }
    }
    if (category !== 'generic' && !meta.detect) problems.push(`${where}: non-generic skills should declare detect rules`);
    for (const c of meta.commands ?? []) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.name ?? '')) problems.push(`${where}: command name "${c.name}" must be lowercase-hyphenated`);
      if (!c.description || !c.prompt) problems.push(`${where}: command "${c.name}" needs description and prompt`);
    }
    if (meta.run !== undefined && (!meta.run.label || !meta.run.prompt || /[\r\n]/.test(meta.run.prompt))) problems.push(`${where}: run needs label and a single-line prompt`);
    if (meta.rule !== undefined && (typeof meta.rule !== 'string' || meta.rule.length < 20)) problems.push(`${where}: rule must be a sentence`);
    for (const u of meta.upstream ?? []) {
      if (!/^[\w.-]+\/[\w.-]+$/.test(u.repo ?? '')) problems.push(`${where}: upstream repo "${u.repo}" is not owner/name`);
    }
  }
}

if (problems.length) {
  console.error('Skill validation failed:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log(`validated ${ids.size} skills`);
