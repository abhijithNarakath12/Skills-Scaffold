import * as fs from 'fs/promises';
import * as path from 'path';
import { parseFrontmatter } from './frontmatter';
import type { TargetInfo } from './targets';
import { MANIFEST_FILE, type InstallManifest, type InstalledSkill } from './types';

export interface InstallOptions {
  workspaceRoot: string;
  targets: TargetInfo[];
  linkSecondary: boolean;
  overwrite?: boolean;
}

export interface InstallResult {
  id: string;
  /** Absolute paths written (primary copy + secondary links/copies). */
  paths: string[];
  skipped?: 'exists';
  linkedFallbackToCopy?: boolean;
}

/** Installs a skill directory from `sourceDir` into every configured target. */
export async function installSkillDir(sourceDir: string, id: string, manifest: InstallManifest, opts: InstallOptions): Promise<InstallResult> {
  if (!opts.targets.length) {
    throw new Error('No install targets configured.');
  }
  const [primary, ...secondary] = opts.targets;
  const primaryDir = path.join(opts.workspaceRoot, primary.dir, id);
  const result: InstallResult = { id, paths: [] };

  if (await exists(primaryDir)) {
    if (!opts.overwrite) {
      result.skipped = 'exists';
      return result;
    }
    await fs.rm(primaryDir, { recursive: true, force: true });
  }
  await fs.mkdir(path.dirname(primaryDir), { recursive: true });
  await copyDir(sourceDir, primaryDir);
  await fs.writeFile(path.join(primaryDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  result.paths.push(primaryDir);

  for (const target of secondary) {
    const dest = path.join(opts.workspaceRoot, target.dir, id);
    if (await exists(dest)) {
      if (!opts.overwrite) {
        continue;
      }
      await fs.rm(dest, { recursive: true, force: true });
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    let linked = false;
    if (opts.linkSecondary) {
      try {
        const rel = path.relative(path.dirname(dest), primaryDir);
        await fs.symlink(rel, dest, process.platform === 'win32' ? 'junction' : 'dir');
        linked = true;
      } catch {
        linked = false;
      }
    }
    if (!linked) {
      await copyDir(primaryDir, dest);
      if (opts.linkSecondary) {
        result.linkedFallbackToCopy = true;
      }
    }
    result.paths.push(dest);
  }
  return result;
}

/** Removes a skill folder (or link) from every target. */
export async function removeSkill(workspaceRoot: string, targets: TargetInfo[], id: string): Promise<string[]> {
  const removed: string[] = [];
  for (const target of targets) {
    const dir = path.join(workspaceRoot, target.dir, id);
    try {
      const stat = await fs.lstat(dir);
      if (stat.isSymbolicLink()) {
        await fs.unlink(dir);
      } else {
        await fs.rm(dir, { recursive: true, force: true });
      }
      removed.push(dir);
    } catch {
      // not present in this target
    }
  }
  return removed;
}

/** Lists skills found in all targets of a workspace. */
export async function listInstalled(workspaceRoot: string, targets: TargetInfo[]): Promise<InstalledSkill[]> {
  const out: InstalledSkill[] = [];
  for (const target of targets) {
    const base = path.join(workspaceRoot, target.dir);
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) {
        continue;
      }
      const dir = path.join(base, ent.name);
      const isSymlink = ent.isSymbolicLink();
      let isDir = ent.isDirectory();
      if (isSymlink) {
        try {
          isDir = (await fs.stat(dir)).isDirectory();
        } catch {
          continue;
        }
      }
      if (!isDir) {
        continue;
      }
      const skillFile = path.join(dir, 'SKILL.md');
      let fm: { name?: string; description?: string } = {};
      try {
        fm = parseFrontmatter(await fs.readFile(skillFile, 'utf8')).data;
      } catch {
        continue; // not a skill folder
      }
      let manifest: InstallManifest | undefined;
      try {
        manifest = JSON.parse(await fs.readFile(path.join(dir, MANIFEST_FILE), 'utf8')) as InstallManifest;
      } catch {
        manifest = undefined;
      }
      out.push({
        id: ent.name,
        name: fm.name ?? ent.name,
        description: fm.description ?? '',
        path: dir,
        target: target.key,
        manifest,
        isSymlink,
      });
    }
  }
  return out;
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

export async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name === 'skill.json' || ent.name === '.DS_Store') {
      continue; // extension-internal metadata is not part of the skill
    }
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      await copyDir(s, d);
    } else if (ent.isFile()) {
      await fs.copyFile(s, d);
    }
  }
}

/** Scaffolds a new, empty skill folder with a SKILL.md template. */
export function skillTemplate(name: string, description: string): string {
  return `---
name: ${name}
description: ${description}
---

# ${name}

## When to use this skill

Describe the situations in which an agent should load this skill.

## Instructions

1. Step one.
2. Step two.

## Conventions

- Convention the agent must follow.

## Resources

- Put long reference material in \`references/\` and scripts in \`scripts/\`, and link to them from here.
`;
}
