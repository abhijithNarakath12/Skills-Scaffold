import * as fs from 'fs/promises';
import * as path from 'path';
import type { TargetInfo } from './targets';
import type { CatalogEntry, SkillCommand } from './types';

export const BLOCK_BEGIN = '<!-- agent-skills-manager:begin -->';
export const BLOCK_END = '<!-- agent-skills-manager:end -->';
const BLOCK_HEADING = '## Agent skill rules';
const BLOCK_NOTE = 'Managed by the Agent Skills Manager extension. Edit the skills themselves rather than this block; it is rewritten when skills are added or removed.';
const COMMAND_MARKER = 'generated-by: agent-skills-manager';

export interface Rule {
  id: string;
  text: string;
}

export interface InstructionFile {
  /** Workspace-relative path. */
  path: string;
  /** Frontmatter prepended when the file is created by us. */
  header?: string;
}

/** The always-on instruction file an agent reads for a target. */
export function instructionFileFor(target: TargetInfo): InstructionFile {
  switch (target.key) {
    case 'claude':
      return { path: 'CLAUDE.md' };
    case 'cursor':
      return { path: '.cursor/rules/agent-skills.mdc', header: '---\ndescription: Rules for installed agent skills\nalwaysApply: true\n---\n' };
    case 'copilot':
      return { path: '.github/copilot-instructions.md' };
    case 'gemini':
      return { path: 'GEMINI.md' };
    case 'windsurf':
      return { path: '.windsurf/rules/agent-skills.md', header: '---\ntrigger: always_on\n---\n' };
    default:
      // universal, codex, opencode, custom
      return { path: 'AGENTS.md' };
  }
}

/** Parses the rules currently stored in a managed block. */
export function readManagedRules(text: string): Rule[] {
  const start = text.indexOf(BLOCK_BEGIN);
  const end = text.indexOf(BLOCK_END);
  if (start === -1 || end === -1 || end < start) {
    return [];
  }
  const block = text.slice(start + BLOCK_BEGIN.length, end);
  const rules: Rule[] = [];
  for (const m of block.matchAll(/^- \*\*([a-z0-9-]+)\*\*: ([\s\S]*?)(?=\n- \*\*|\n*$)/gm)) {
    rules.push({ id: m[1], text: m[2].trim() });
  }
  return rules;
}

function renderBlock(rules: Rule[]): string {
  const lines = [BLOCK_BEGIN, BLOCK_HEADING, '', BLOCK_NOTE, '', ...rules.map((r) => `- **${r.id}**: ${r.text}`), BLOCK_END];
  return lines.join('\n');
}

/** Returns the file text with the managed block updated to contain exactly `rules`; removes the block when empty. */
export function withManagedRules(text: string, rules: Rule[], header?: string): string {
  const start = text.indexOf(BLOCK_BEGIN);
  const end = text.indexOf(BLOCK_END);
  const hasBlock = start !== -1 && end !== -1 && end > start;
  const before = hasBlock ? text.slice(0, start).replace(/\n*$/, '') : text.replace(/\n*$/, '');
  const after = hasBlock ? text.slice(end + BLOCK_END.length).replace(/^\n*/, '').replace(/\n*$/, '') : '';
  if (!rules.length) {
    const joined = [before, after].filter(Boolean).join('\n\n');
    return joined ? joined + '\n' : '';
  }
  const block = renderBlock(rules);
  if (!before && !after && header) {
    return header + '\n' + block + '\n';
  }
  return [before, block, after].filter(Boolean).join('\n\n') + '\n';
}

/** Adds or replaces one rule, keeping the others. */
export function upsertRule(rules: Rule[], rule: Rule): Rule[] {
  const others = rules.filter((r) => r.id !== rule.id);
  return [...others, rule].sort((a, b) => a.id.localeCompare(b.id));
}

export interface CommandFile {
  path: string;
  content: string;
}

/** Project-level slash command files for a target, or [] when the agent has no such mechanism. */
export function commandFilesFor(target: TargetInfo, skillId: string, command: SkillCommand): CommandFile[] {
  const body = `${command.prompt.trim()}\n`;
  const marker = `<!-- ${COMMAND_MARKER} skill=${skillId} -->`;
  switch (target.key) {
    case 'claude':
      return [{ path: `.claude/commands/${command.name}.md`, content: `---\ndescription: ${command.description}\nargument-hint: <what to work on>\n---\n${marker}\n\n${body}` }];
    case 'cursor':
      return [{ path: `.cursor/commands/${command.name}.md`, content: `${marker}\n\n# /${command.name}\n\n${command.description}\n\n${body.replace(/\$ARGUMENTS/g, 'the request that follows this command')}` }];
    case 'copilot':
      return [{ path: `.github/prompts/${command.name}.prompt.md`, content: `---\ndescription: ${command.description}\nagent: agent\n---\n${marker}\n\n${body.replace(/\$ARGUMENTS/g, 'the request that follows this prompt')}` }];
    case 'gemini':
      return [{ path: `.gemini/commands/${command.name}.toml`, content: `# ${COMMAND_MARKER} skill=${skillId}\ndescription = ${JSON.stringify(command.description)}\nprompt = """\n${body.replace(/\$ARGUMENTS/g, '{{args}}')}"""\n` }];
    case 'windsurf':
      return [{ path: `.windsurf/workflows/${command.name}.md`, content: `---\ndescription: ${command.description}\n---\n${marker}\n\n${body.replace(/\$ARGUMENTS/g, 'the request that follows this workflow')}` }];
    case 'opencode':
      return [{ path: `.opencode/command/${command.name}.md`, content: `---\ndescription: ${command.description}\n---\n${marker}\n\n${body}` }];
    default:
      return []; // codex / universal / custom: no project-level command files
  }
}

export interface IntegrationResult {
  instructionFiles: string[];
  commandFiles: string[];
}

/** Writes always-on rules and slash commands for an installed skill across all targets. */
export async function applySkillIntegration(workspaceRoot: string, targets: TargetInfo[], entry: CatalogEntry, opts: { rules: boolean; commands: boolean }): Promise<IntegrationResult> {
  const result: IntegrationResult = { instructionFiles: [], commandFiles: [] };
  const seenInstruction = new Set<string>();
  for (const target of targets) {
    if (opts.rules && entry.rule) {
      const file = instructionFileFor(target);
      if (!seenInstruction.has(file.path)) {
        seenInstruction.add(file.path);
        const abs = path.join(workspaceRoot, file.path);
        const current = await readIfExists(abs);
        const rules = upsertRule(readManagedRules(current), { id: entry.id, text: entry.rule });
        await writeFile(abs, withManagedRules(current, rules, file.header));
        result.instructionFiles.push(file.path);
      }
    }
    if (opts.commands) {
      for (const command of entry.commands ?? []) {
        for (const cf of commandFilesFor(target, entry.id, command)) {
          const abs = path.join(workspaceRoot, cf.path);
          const current = await readIfExists(abs);
          if (current && !current.includes(COMMAND_MARKER)) {
            continue; // never overwrite a command the user wrote themselves
          }
          await writeFile(abs, cf.content);
          result.commandFiles.push(cf.path);
        }
      }
    }
  }
  return result;
}

/** Removes a skill's rule and generated commands from all targets. */
export async function removeSkillIntegration(workspaceRoot: string, targets: TargetInfo[], entry: Pick<CatalogEntry, 'id' | 'commands'>): Promise<IntegrationResult> {
  const result: IntegrationResult = { instructionFiles: [], commandFiles: [] };
  const seenInstruction = new Set<string>();
  for (const target of targets) {
    const file = instructionFileFor(target);
    if (!seenInstruction.has(file.path)) {
      seenInstruction.add(file.path);
      const abs = path.join(workspaceRoot, file.path);
      const current = await readIfExists(abs);
      const rules = readManagedRules(current);
      if (rules.some((r) => r.id === entry.id)) {
        const next = withManagedRules(current, rules.filter((r) => r.id !== entry.id), file.header);
        if (next.trim() === '' || next.trim() === (file.header ?? '').trim()) {
          await fs.rm(abs, { force: true });
        } else {
          await writeFile(abs, next);
        }
        result.instructionFiles.push(file.path);
      }
    }
    for (const command of entry.commands ?? []) {
      for (const cf of commandFilesFor(target, entry.id, command)) {
        const abs = path.join(workspaceRoot, cf.path);
        const current = await readIfExists(abs);
        if (current.includes(`${COMMAND_MARKER} skill=${entry.id}`)) {
          await fs.rm(abs, { force: true });
          result.commandFiles.push(cf.path);
        }
      }
    }
  }
  return result;
}

async function readIfExists(file: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}
