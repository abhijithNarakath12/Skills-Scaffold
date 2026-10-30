import * as fs from 'fs/promises';
import * as path from 'path';
import type { CatalogEntry, DetectRules } from './types';

export interface DetectedStack {
  npm: Set<string>;
  pip: Set<string>;
  go: Set<string>;
  cargo: Set<string>;
  jvm: Set<string>;
  gem: Set<string>;
  composer: Set<string>;
  nuget: Set<string>;
  pub: Set<string>;
  swift: Set<string>;
  files: Set<string>;
  extensions: Set<string>;
}

export interface Recommendation {
  entry: CatalogEntry;
  reasons: string[];
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '.venv', 'venv', '__pycache__',
  '.next', '.nuxt', '.svelte-kit', 'coverage', '.idea', '.vscode', 'bin', 'obj', '.dart_tool', 'Pods',
  '.gradle', '.terraform', '.cache', 'tmp', 'logs',
]);

const MANIFEST_DEPTH = 2;
const SOURCE_SCAN_DEPTH = 4;
const SOURCE_SCAN_LIMIT = 3000;

export function emptyStack(): DetectedStack {
  return {
    npm: new Set(), pip: new Set(), go: new Set(), cargo: new Set(), jvm: new Set(), gem: new Set(),
    composer: new Set(), nuget: new Set(), pub: new Set(), swift: new Set(), files: new Set(), extensions: new Set(),
  };
}

/** Scans a workspace folder for dependency manifests and source files. */
export async function detectStack(root: string): Promise<DetectedStack> {
  const stack = emptyStack();
  let scanned = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (scanned > SOURCE_SCAN_LIMIT) {
        return;
      }
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (IGNORED_DIRS.has(ent.name) || (ent.name.startsWith('.') && depth > 0)) {
          continue;
        }
        if (depth < SOURCE_SCAN_DEPTH) {
          await walk(full, depth + 1);
        }
        continue;
      }
      if (!ent.isFile()) {
        continue;
      }
      scanned++;
      const ext = path.extname(ent.name).toLowerCase();
      if (ext) {
        stack.extensions.add(ext);
      }
      if (depth <= MANIFEST_DEPTH) {
        stack.files.add(ent.name);
        await readManifest(full, ent.name, stack);
      }
    }
  }

  await walk(root, 0);
  return stack;
}

async function readManifest(file: string, name: string, stack: DetectedStack): Promise<void> {
  const lower = name.toLowerCase();
  const readers: Array<[boolean, (text: string) => void]> = [
    [lower === 'package.json', (t) => parsePackageJson(t, stack.npm)],
    [/^requirements.*\.txt$/.test(lower) || lower === 'constraints.txt', (t) => parseRequirements(t, stack.pip)],
    [lower === 'pyproject.toml', (t) => parsePyproject(t, stack.pip)],
    [lower === 'pipfile', (t) => parseTomlLikeDeps(t, ['packages', 'dev-packages'], stack.pip)],
    [lower === 'environment.yml' || lower === 'environment.yaml', (t) => parseCondaEnv(t, stack.pip)],
    [lower === 'go.mod', (t) => parseGoMod(t, stack.go)],
    [lower === 'cargo.toml', (t) => parseTomlLikeDeps(t, ['dependencies', 'dev-dependencies', 'build-dependencies'], stack.cargo)],
    [lower === 'pom.xml', (t) => parsePom(t, stack.jvm)],
    [lower === 'build.gradle' || lower === 'build.gradle.kts', (t) => parseGradle(t, stack.jvm)],
    [lower === 'gemfile', (t) => parseGemfile(t, stack.gem)],
    [lower === 'composer.json', (t) => parseComposer(t, stack.composer)],
    [lower.endsWith('.csproj') || lower.endsWith('.fsproj') || lower === 'directory.packages.props', (t) => parseCsproj(t, stack.nuget)],
    [lower === 'pubspec.yaml', (t) => parsePubspec(t, stack.pub)],
    [lower === 'package.swift' || lower === 'podfile', (t) => parseSwift(t, stack.swift)],
  ];
  const reader = readers.find(([match]) => match);
  if (!reader) {
    return;
  }
  try {
    const text = await fs.readFile(file, 'utf8');
    reader[1](text);
  } catch {
    // unreadable manifest: ignore
  }
}

function parsePackageJson(text: string, out: Set<string>): void {
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const deps = json[key];
      if (deps && typeof deps === 'object') {
        for (const dep of Object.keys(deps as object)) {
          out.add(dep.toLowerCase());
        }
      }
    }
  } catch {
    // invalid JSON
  }
}

function normalizePy(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

function parseRequirements(text: string, out: Set<string>): void {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) {
      continue;
    }
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line);
    if (m) {
      out.add(normalizePy(m[1]));
    }
  }
}

function parsePyproject(text: string, out: Set<string>): void {
  // PEP 621: dependencies = ["fastapi>=0.1", ...] and [project.optional-dependencies]
  const arrays = text.match(/dependencies\s*=\s*\[([^\]]*)\]/g) ?? [];
  for (const arr of arrays) {
    for (const m of arr.matchAll(/["']([A-Za-z0-9][A-Za-z0-9._-]*)/g)) {
      out.add(normalizePy(m[1]));
    }
  }
  // optional-dependencies groups: name = [ ... ]
  const optional = /\[project\.optional-dependencies\]([\s\S]*?)(?:\n\[|$)/.exec(text);
  if (optional) {
    for (const m of optional[1].matchAll(/["']([A-Za-z0-9][A-Za-z0-9._-]*)/g)) {
      out.add(normalizePy(m[1]));
    }
  }
  // Poetry
  parseTomlLikeDeps(text, ['tool.poetry.dependencies', 'tool.poetry.dev-dependencies', 'tool.poetry.group.dev.dependencies'], out, normalizePy);
  // uv / PDM dev groups
  const depGroups = /\[dependency-groups\]([\s\S]*?)(?:\n\[|$)/.exec(text);
  if (depGroups) {
    for (const m of depGroups[1].matchAll(/["']([A-Za-z0-9][A-Za-z0-9._-]*)/g)) {
      out.add(normalizePy(m[1]));
    }
  }
}

function parseTomlLikeDeps(text: string, sections: string[], out: Set<string>, normalize: (s: string) => string = (s) => s.toLowerCase()): void {
  const lines = text.split('\n');
  let current = '';
  for (const raw of lines) {
    const line = raw.trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      current = header[1].trim();
      continue;
    }
    if (!current || !sections.some((s) => current === s || current.startsWith(s + '.'))) {
      continue;
    }
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/.exec(line);
    if (m && m[1] !== 'python') {
      out.add(normalize(m[1]));
    }
  }
}

function parseCondaEnv(text: string, out: Set<string>): void {
  for (const m of text.matchAll(/^\s*-\s*([A-Za-z0-9][A-Za-z0-9._-]*)/gm)) {
    out.add(normalizePy(m[1]));
  }
}

function parseGoMod(text: string, out: Set<string>): void {
  for (const m of text.matchAll(/^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]+\/[^\s]+)\s+v[0-9]/gm)) {
    out.add(m[1]);
  }
}

function parsePom(text: string, out: Set<string>): void {
  for (const m of text.matchAll(/<groupId>\s*([^<\s]+)\s*<\/groupId>\s*<artifactId>\s*([^<\s]+)\s*<\/artifactId>/g)) {
    out.add(m[1]);
    out.add(`${m[1]}:${m[2]}`);
  }
  const parent = /<parent>[\s\S]*?<groupId>\s*([^<\s]+)\s*<\/groupId>[\s\S]*?<artifactId>\s*([^<\s]+)/.exec(text);
  if (parent) {
    out.add(parent[1]);
    out.add(`${parent[1]}:${parent[2]}`);
  }
}

function parseGradle(text: string, out: Set<string>): void {
  for (const m of text.matchAll(/["']([a-zA-Z0-9_.-]+):([a-zA-Z0-9_.-]+)(?::[^"']*)?["']/g)) {
    out.add(m[1]);
    out.add(`${m[1]}:${m[2]}`);
  }
  for (const m of text.matchAll(/id\s*\(?\s*["']([a-zA-Z0-9_.-]+)["']/g)) {
    out.add(m[1]);
  }
}

function parseGemfile(text: string, out: Set<string>): void {
  for (const m of text.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)) {
    out.add(m[1].toLowerCase());
  }
}

function parseComposer(text: string, out: Set<string>): void {
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    for (const key of ['require', 'require-dev']) {
      const deps = json[key];
      if (deps && typeof deps === 'object') {
        for (const dep of Object.keys(deps as object)) {
          out.add(dep.toLowerCase());
        }
      }
    }
  } catch {
    // ignore
  }
}

function parseCsproj(text: string, out: Set<string>): void {
  for (const m of text.matchAll(/<Package(?:Reference|Version)\s+Include="([^"]+)"/g)) {
    out.add(m[1].toLowerCase());
  }
  const sdk = /<Project\s+Sdk="([^"]+)"/.exec(text);
  if (sdk) {
    out.add(sdk[1].toLowerCase());
  }
}

function parsePubspec(text: string, out: Set<string>): void {
  const section = /(?:^|\n)(?:dev_)?dependencies:\n([\s\S]*?)(?=\n\S|$)/g;
  for (const m of text.matchAll(section)) {
    for (const dep of m[1].matchAll(/^\s{2}([a-z0-9_]+):/gm)) {
      out.add(dep[1]);
    }
  }
}

function parseSwift(text: string, out: Set<string>): void {
  for (const m of text.matchAll(/url:\s*"https?:\/\/[^"]+\/([^"/]+?)(?:\.git)?"/g)) {
    out.add(m[1].toLowerCase());
  }
  for (const m of text.matchAll(/^\s*pod\s+["']([^"']+)["']/gm)) {
    out.add(m[1].toLowerCase());
  }
}

function globToRegExp(glob: string): RegExp {
  return new RegExp('^' + glob.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
}

/** Returns the reasons a skill matches a detected stack, or an empty array. */
export function matchRules(rules: DetectRules | undefined, stack: DetectedStack): string[] {
  if (!rules) {
    return [];
  }
  const reasons: string[] = [];
  const check = (label: string, wanted: string[] | undefined, have: Set<string>, prefix = false) => {
    for (const w of wanted ?? []) {
      const needle = w.toLowerCase();
      const hit = prefix
        ? [...have].find((h) => h === needle || h.startsWith(needle + '/') || h.startsWith(needle))
        : have.has(needle)
          ? needle
          : undefined;
      if (hit) {
        reasons.push(`${label}: ${w}`);
      }
    }
  };
  check('npm', rules.npm, stack.npm);
  check('pip', rules.pip?.map((p) => p.toLowerCase().replace(/[-_.]+/g, '-')), stack.pip);
  check('go', rules.go, stack.go, true);
  check('cargo', rules.cargo, stack.cargo);
  check('jvm', rules.jvm, stack.jvm);
  check('gem', rules.gem, stack.gem);
  check('composer', rules.composer, stack.composer);
  check('nuget', rules.nuget, stack.nuget);
  check('pub', rules.pub, stack.pub);
  check('swift', rules.swift, stack.swift);
  for (const f of rules.files ?? []) {
    const re = globToRegExp(f);
    if ([...stack.files].some((name) => re.test(name))) {
      reasons.push(`file: ${f}`);
    }
  }
  for (const ext of rules.extensions ?? []) {
    if (stack.extensions.has(ext.toLowerCase())) {
      reasons.push(`files with ${ext}`);
    }
  }
  return reasons;
}

/** Ranks catalog skills by how strongly they match the detected stack. */
export function recommend(entries: CatalogEntry[], stack: DetectedStack): Recommendation[] {
  const out: Recommendation[] = [];
  for (const entry of entries) {
    const reasons = matchRules(entry.detect, stack);
    if (reasons.length) {
      out.push({ entry, reasons });
    }
  }
  // Dependency matches are stronger than extension-only matches.
  const score = (r: Recommendation) => r.reasons.filter((x) => !x.startsWith('files with')).length * 10 + r.reasons.length;
  return out.sort((a, b) => score(b) - score(a) || a.entry.id.localeCompare(b.entry.id));
}
