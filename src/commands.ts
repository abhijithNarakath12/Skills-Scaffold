import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CATEGORY_LABELS, withRecommended } from './core/catalog';
import { isValidSkillName } from './core/frontmatter';
import { exists, installSkillDir, removeSkill, skillTemplate, type InstallResult } from './core/installer';
import { applySkillIntegration, removeSkillIntegration } from './core/integration';
import { claudeCommand, resolveRunMode } from './core/run';
import { GitHubClient, parseGitHubReference, type RemoteSkill, type RemoteSource } from './core/remote';
import { TARGETS } from './core/targets';
import type { CatalogEntry, InstallManifest } from './core/types';
import type { SkillService } from './service';
import type { TreeNode } from './views/skillsTree';

interface SkillPick extends vscode.QuickPickItem {
  entry: CatalogEntry;
}

export function registerCommands(service: SkillService): vscode.Disposable[] {
  const reg = (id: string, fn: (...args: unknown[]) => unknown) => vscode.commands.registerCommand(id, fn);
  return [
    reg('agentSkills.addSkills', () => addSkillsInteractive(service)),
    reg('agentSkills.addRecommended', () => addRecommended(service)),
    reg('agentSkills.addWorkflowSkills', () => addByCategory(service, 'generic')),
    reg('agentSkills.installSkill', (node) => installFromNode(service, node as TreeNode)),
    reg('agentSkills.installUpstream', (node) => installUpstream(service, node as TreeNode | undefined)),
    reg('agentSkills.removeSkill', (node) => removeFromNode(service, node as TreeNode | undefined)),
    reg('agentSkills.updateInstalled', () => updateInstalled(service)),
    reg('agentSkills.addFromGitHub', () => addFromGitHub(service)),
    reg('agentSkills.browseRemoteSource', () => browseRemoteSource(service)),
    reg('agentSkills.createSkill', () => createSkill(service)),
    reg('agentSkills.openSkill', (node) => openSkill(service, node as TreeNode)),
    reg('agentSkills.refresh', () => service.refresh()),
    reg('agentSkills.selectTargets', () => selectTargets(service)),
    reg('agentSkills.syncIntegrations', () => syncIntegrations(service)),
    reg('agentSkills.runSkill', (node) => runSkill(service, node as TreeNode | undefined)),
  ];
}

function targetSummary(service: SkillService): string {
  return service.targets.map((t) => t.dir).join(', ');
}

async function installEntries(service: SkillService, folder: vscode.WorkspaceFolder, entries: CatalogEntry[], overwrite = false): Promise<void> {
  if (!entries.length) {
    return;
  }
  const results: InstallResult[] = [];
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Adding skills to project', cancellable: false }, async (progress) => {
    for (const [i, entry] of entries.entries()) {
      progress.report({ message: `${entry.name} (${i + 1}/${entries.length})`, increment: 100 / entries.length });
      const manifest: InstallManifest = { installedBy: 'agent-skills-manager', source: { type: 'bundled', id: entry.id, version: entry.version }, installedAt: new Date().toISOString() };
      results.push(
        await installSkillDir(service.skillSourceDir(entry), entry.id, manifest, {
          workspaceRoot: folder.uri.fsPath,
          targets: service.targets,
          linkSecondary: service.linkSecondary,
          overwrite,
        }),
      );
    }
  });
  service.refresh();
  const added = results.filter((r) => !r.skipped);
  const skipped = results.filter((r) => r.skipped === 'exists');
  for (const r of results) {
    service.log(r.skipped ? `Skipped ${r.id} (already present)` : `Installed ${r.id} -> ${r.paths.join(', ')}`);
  }
  const parts: string[] = [];
  if (added.length) {
    parts.push(`Added ${added.length} skill${added.length === 1 ? '' : 's'} to ${targetSummary(service)}`);
  }
  if (skipped.length) {
    parts.push(`${skipped.length} already present (${skipped.map((s) => s.id).join(', ')})`);
  }
  if (results.some((r) => r.linkedFallbackToCopy)) {
    parts.push('symlinks were not possible, secondary targets got copies');
  }
  const integrated = await integrate(service, folder, entries);
  if (integrated.length) {
    parts.push(`updated ${integrated.join(', ')}`);
  }
  const message = parts.join('. ') + '.';
  if (added.length) {
    const choice = await vscode.window.showInformationMessage(message, 'Open Folder in Explorer');
    if (choice) {
      await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(added[0].paths[0]));
    }
  } else {
    void vscode.window.showInformationMessage(message);
  }
}

async function addSkillsInteractive(service: SkillService): Promise<void> {
  const folder = await service.pickWorkspace();
  if (!folder) {
    return;
  }
  const [catalog, recs, installed] = await Promise.all([service.getCatalog(), service.getRecommendations(folder), service.getInstalled(folder)]);
  const installedIds = new Set(installed.map((s) => s.id));
  const recommendedIds = new Map(recs.map((r) => [r.entry.id, r.reasons]));

  const items: (SkillPick | vscode.QuickPickItem)[] = [];
  let lastCategory = '';
  for (const entry of catalog.skills) {
    if (entry.category !== lastCategory) {
      items.push({ label: CATEGORY_LABELS[entry.category], kind: vscode.QuickPickItemKind.Separator });
      lastCategory = entry.category;
    }
    const reasons = recommendedIds.get(entry.id);
    items.push({
      label: `$(${installedIds.has(entry.id) ? 'check' : reasons ? 'sparkle' : 'book'}) ${entry.title ?? entry.name}`,
      description: installedIds.has(entry.id) ? 'installed' : reasons ? `recommended · ${reasons.join(', ')}` : undefined,
      detail: entry.description,
      picked: !!reasons && !installedIds.has(entry.id) && entry.category !== 'generic',
      entry,
    } as SkillPick);
  }
  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    matchOnDescription: true,
    matchOnDetail: true,
    placeHolder: `Select skills to add to ${targetSummary(service)} (recommended ones are pre-selected)`,
    title: 'Add Skills to Project',
  });
  if (!picked) {
    return;
  }
  const selected = (picked as SkillPick[]).filter((p) => p.entry).map((p) => p.entry.id);
  const ids = withRecommended(catalog.skills, selected);
  const entries = catalog.skills.filter((e) => ids.includes(e.id));
  await installEntries(service, folder, entries);
}

async function addRecommended(service: SkillService): Promise<void> {
  const folder = await service.pickWorkspace();
  if (!folder) {
    return;
  }
  const [catalog, recs, installed] = await Promise.all([service.getCatalog(), service.getRecommendations(folder), service.getInstalled(folder)]);
  const installedIds = new Set(installed.map((s) => s.id));
  const generic = catalog.skills.filter((s) => s.category === 'generic');
  const candidates = [...recs.map((r) => r.entry), ...generic].filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i);
  const items: SkillPick[] = candidates.map((entry) => {
    const reasons = recs.find((r) => r.entry.id === entry.id)?.reasons;
    return {
      label: `$(${entry.category === 'generic' ? 'checklist' : 'sparkle'}) ${entry.title ?? entry.name}`,
      description: installedIds.has(entry.id) ? 'installed' : reasons ? reasons.join(', ') : 'workflow skill',
      detail: entry.description,
      picked: !installedIds.has(entry.id),
      entry,
    };
  });
  if (!items.length) {
    void vscode.window.showInformationMessage('No stack detected in this project. Use "Add Skills to Project" to browse the catalog.');
    return;
  }
  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: 'Recommended skills for this project',
    placeHolder: 'Confirm which skills to add',
  });
  if (!picked) {
    return;
  }
  const ids = withRecommended(catalog.skills, picked.map((p) => p.entry.id));
  await installEntries(service, folder, catalog.skills.filter((e) => ids.includes(e.id)));
}

async function addByCategory(service: SkillService, category: CatalogEntry['category']): Promise<void> {
  const folder = await service.pickWorkspace();
  if (!folder) {
    return;
  }
  const catalog = await service.getCatalog();
  await installEntries(service, folder, catalog.skills.filter((e) => e.category === category));
}

async function installFromNode(service: SkillService, node: TreeNode | undefined): Promise<void> {
  if (!node || node.kind !== 'skill') {
    return addSkillsInteractive(service);
  }
  const folder = await service.pickWorkspace();
  if (!folder) {
    return;
  }
  const catalog = await service.getCatalog();
  const ids = withRecommended(catalog.skills, [node.entry.id]);
  await installEntries(service, folder, catalog.skills.filter((e) => ids.includes(e.id)));
}

async function removeFromNode(service: SkillService, node: TreeNode | undefined): Promise<void> {
  const folder = await service.pickWorkspace();
  if (!folder) {
    return;
  }
  let id: string | undefined;
  if (node && (node.kind === 'installed' || node.kind === 'skill')) {
    id = node.kind === 'installed' ? node.skill.id : node.entry.id;
  } else {
    const installed = await service.getInstalled(folder);
    const pick = await vscode.window.showQuickPick(
      [...new Set(installed.map((s) => s.id))].map((i) => ({ label: i })),
      { placeHolder: 'Skill to remove' },
    );
    id = pick?.label;
  }
  if (!id) {
    return;
  }
  const confirm = await vscode.window.showWarningMessage(`Remove skill "${id}" from ${targetSummary(service)}?`, { modal: true }, 'Remove');
  if (confirm !== 'Remove') {
    return;
  }
  const removed = await removeSkill(folder.uri.fsPath, service.targets, id);
  service.log(`Removed ${id}: ${removed.join(', ') || 'not found'}`);
  const entry = await service.getEntry(id);
  if (entry) {
    const cleaned = await removeSkillIntegration(folder.uri.fsPath, service.targets, entry);
    const files = [...cleaned.instructionFiles, ...cleaned.commandFiles];
    if (files.length) {
      service.log(`Removed rules/commands of ${id} from ${files.join(', ')}`);
    }
  }
  service.refresh();
  void vscode.window.showInformationMessage(removed.length ? `Removed ${id} (${removed.length} location${removed.length === 1 ? '' : 's'}).` : `${id} was not found.`);
}

async function updateInstalled(service: SkillService): Promise<void> {
  const folder = await service.pickWorkspace();
  if (!folder) {
    return;
  }
  const [installed, catalog] = await Promise.all([service.getInstalled(folder), service.getCatalog()]);
  const byId = new Map(catalog.skills.map((e) => [e.id, e]));
  const outdated = installed
    .filter((s) => s.manifest?.source.type === 'bundled' && byId.has(s.id) && s.manifest.source.version !== byId.get(s.id)!.version)
    .map((s) => byId.get(s.id)!)
    .filter((e, i, arr) => arr.indexOf(e) === i);
  if (!outdated.length) {
    void vscode.window.showInformationMessage('All bundled skills in this project are up to date.');
    return;
  }
  const confirm = await vscode.window.showInformationMessage(
    `Update ${outdated.length} skill${outdated.length === 1 ? '' : 's'} (${outdated.map((e) => e.id).join(', ')})? Local edits to those folders will be overwritten.`,
    { modal: true },
    'Update',
  );
  if (confirm !== 'Update') {
    return;
  }
  await installEntries(service, folder, outdated, true);
}

async function pickRemoteSource(service: SkillService): Promise<RemoteSource | undefined> {
  const sources = service.remoteSources;
  const items = sources.map((s) => ({ label: s.label ?? s.repo, description: s.repo + (s.path ? `/${s.path}` : ''), source: s }));
  const pick = await vscode.window.showQuickPick([...items, { label: '$(edit) Enter a repository or URL...', description: '', source: undefined }], {
    placeHolder: 'Community skill source',
    title: 'Browse community skills',
  });
  if (!pick) {
    return undefined;
  }
  if (pick.source) {
    return pick.source;
  }
  const input = await vscode.window.showInputBox({
    prompt: 'GitHub repository (owner/repo), optional path (owner/repo/skills/foo) or a github.com URL',
    placeHolder: 'anthropics/skills/skills',
    validateInput: (v) => (parseGitHubReference(v) ? undefined : 'Enter owner/repo or a github.com URL'),
  });
  return input ? parseGitHubReference(input) : undefined;
}

async function installRemote(service: SkillService, folder: vscode.WorkspaceFolder, client: GitHubClient, skills: RemoteSkill[]): Promise<void> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-skills-'));
  const results: InstallResult[] = [];
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Downloading skills', cancellable: false }, async (progress) => {
      for (const skill of skills) {
        progress.report({ message: skill.id });
        const dir = path.join(tmpRoot, skill.id);
        await client.download(skill, dir);
        const manifest: InstallManifest = {
          installedBy: 'agent-skills-manager',
          source: { type: 'github', repo: skill.source.repo, path: skill.path, ref: skill.source.ref },
          installedAt: new Date().toISOString(),
        };
        results.push(await installSkillDir(dir, skill.id, manifest, { workspaceRoot: folder.uri.fsPath, targets: service.targets, linkSecondary: service.linkSecondary }));
      }
    });
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
  service.refresh();
  for (const r of results) {
    service.log(r.skipped ? `Skipped community skill ${r.id} (already present)` : `Installed community skill ${r.id} -> ${r.paths.join(', ')}`);
  }
  const added = results.filter((r) => !r.skipped).length;
  const skipped = results.length - added;
  void vscode.window.showInformationMessage(`Added ${added} community skill${added === 1 ? '' : 's'} to ${targetSummary(service)}${skipped ? `, ${skipped} already present` : ''}. Review downloaded SKILL.md files before relying on them.`);
}

async function browseRemoteSource(service: SkillService): Promise<void> {
  const folder = await service.pickWorkspace();
  if (!folder) {
    return;
  }
  const source = await pickRemoteSource(service);
  if (!source) {
    return;
  }
  const client = new GitHubClient(service.githubToken);
  let skills: RemoteSkill[];
  try {
    skills = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Listing skills in ${source.repo}` }, async () => {
      const found = await client.listSkills(source);
      return Promise.all(found.map((s) => client.describe(s).catch(() => s)));
    });
  } catch (err) {
    void vscode.window.showErrorMessage(`Could not list skills: ${(err as Error).message}`);
    return;
  }
  if (!skills.length) {
    void vscode.window.showInformationMessage(`No SKILL.md folders found under ${source.repo}${source.path ? '/' + source.path : ''}.`);
    return;
  }
  const picked = await vscode.window.showQuickPick(
    skills.map((s) => ({ label: s.name ?? s.id, description: s.path, detail: s.description, skill: s })),
    { canPickMany: true, matchOnDetail: true, title: `Skills in ${source.repo}`, placeHolder: 'Select skills to add' },
  );
  if (!picked?.length) {
    return;
  }
  await installRemote(service, folder, client, picked.map((p) => p.skill));
}

async function addFromGitHub(service: SkillService): Promise<void> {
  const folder = await service.pickWorkspace();
  if (!folder) {
    return;
  }
  const input = await vscode.window.showInputBox({
    title: 'Add skill from GitHub',
    prompt: 'Repository (owner/repo), skill folder (owner/repo/skills/name) or a github.com URL to a skill folder',
    placeHolder: 'vercel-labs/agent-skills/skills/react-best-practices',
    validateInput: (v) => (parseGitHubReference(v) ? undefined : 'Enter owner/repo[/path] or a github.com URL'),
  });
  if (!input) {
    return;
  }
  const source = parseGitHubReference(input)!;
  const client = new GitHubClient(service.githubToken);
  try {
    const skills = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Inspecting ${source.repo}` }, () => client.listSkills(source));
    if (!skills.length) {
      void vscode.window.showWarningMessage('No SKILL.md found at that location.');
      return;
    }
    let chosen = skills;
    if (skills.length > 1) {
      const described = await Promise.all(skills.map((s) => client.describe(s).catch(() => s)));
      const picked = await vscode.window.showQuickPick(
        described.map((s) => ({ label: s.name ?? s.id, description: s.path, detail: s.description, skill: s })),
        { canPickMany: true, title: `Skills found in ${source.repo}` },
      );
      if (!picked?.length) {
        return;
      }
      chosen = picked.map((p) => p.skill);
    }
    await installRemote(service, folder, client, chosen);
  } catch (err) {
    void vscode.window.showErrorMessage(`Could not add skill: ${(err as Error).message}`);
  }
}

/** Writes always-on rules and slash commands for the given installed skills; returns touched files. */
async function integrate(service: SkillService, folder: vscode.WorkspaceFolder, entries: CatalogEntry[]): Promise<string[]> {
  const rules = service.config.get<boolean>('enforceRules', true);
  const commands = service.config.get<boolean>('createSlashCommands', true);
  const touched = new Set<string>();
  for (const entry of entries) {
    if (!entry.rule && !entry.commands?.length) {
      continue;
    }
    const res = await applySkillIntegration(folder.uri.fsPath, service.targets, entry, { rules, commands });
    for (const f of [...res.instructionFiles, ...res.commandFiles]) {
      touched.add(f);
    }
  }
  if (touched.size) {
    service.log(`Rules/commands written: ${[...touched].join(', ')}`);
  }
  return [...touched];
}

/** Starts the agent with a runnable skill's prompt, installing the skill first when needed. */
async function runSkill(service: SkillService, node: TreeNode | undefined): Promise<void> {
  const folder = await service.pickWorkspace();
  if (!folder) {
    return;
  }
  const catalog = await service.getCatalog();
  let entry: CatalogEntry | undefined = node?.kind === 'skill' ? node.entry : node?.kind === 'installed' ? node.entry : undefined;
  if (!entry) {
    const runnable = catalog.skills.filter((e) => e.run);
    const pick = await vscode.window.showQuickPick(
      runnable.map((e) => ({ label: `$(play) ${e.run!.label}`, detail: e.description, entry: e })),
      { title: 'Run a skill', matchOnDetail: true },
    );
    entry = pick?.entry;
  }
  if (!entry?.run) {
    void vscode.window.showInformationMessage('This skill has no run action.');
    return;
  }
  const installed = await service.getInstalled(folder);
  if (!installed.some((s) => s.id === entry!.id)) {
    await installEntries(service, folder, [entry]);
  }
  const mode = resolveRunMode(service.config.get<string>('runWith', 'auto'), service.targets[0].key);
  const prompt = entry.run.prompt;
  service.log(`Run ${entry.id} via ${mode}`);
  if (mode === 'claude-terminal') {
    const terminal = vscode.window.createTerminal({ name: entry.run.label, cwd: folder.uri.fsPath });
    terminal.show();
    terminal.sendText(claudeCommand(prompt));
    return;
  }
  if (mode === 'copilot-chat') {
    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt, mode: 'agent' });
      return;
    } catch (err) {
      service.log(`Copilot Chat unavailable: ${(err as Error).message}`);
    }
  }
  await vscode.env.clipboard.writeText(prompt);
  void vscode.window.showInformationMessage(`${entry.run.label}: prompt copied. Paste it into your agent's chat.`);
}

/** Re-applies rules and slash commands for every installed bundled skill (e.g. after changing targets). */
async function syncIntegrations(service: SkillService): Promise<void> {
  const folder = await service.pickWorkspace();
  if (!folder) {
    return;
  }
  const [installed, catalog] = await Promise.all([service.getInstalled(folder), service.getCatalog()]);
  const ids = new Set(installed.map((s) => s.id));
  const entries = catalog.skills.filter((e) => ids.has(e.id));
  const touched = await integrate(service, folder, entries);
  void vscode.window.showInformationMessage(touched.length ? `Updated ${touched.join(', ')}.` : 'No installed skill declares rules or slash commands.');
}

/** Installs a verified community skill covering the same topic as a bundled one. */
async function installUpstream(service: SkillService, node: TreeNode | undefined): Promise<void> {
  const folder = await service.pickWorkspace();
  if (!folder) {
    return;
  }
  const catalog = await service.getCatalog();
  let entry: CatalogEntry | undefined;
  if (node?.kind === 'skill') {
    entry = node.entry;
  } else if (node?.kind === 'installed') {
    entry = node.entry;
  }
  if (!entry) {
    const withUpstream = catalog.skills.filter((e) => e.upstream?.length);
    const pick = await vscode.window.showQuickPick(
      withUpstream.map((e) => ({ label: e.title ?? e.name, description: `${e.upstream!.length} community version${e.upstream!.length === 1 ? '' : 's'}`, detail: e.description, entry: e })),
      { title: 'Install a community version of a skill', matchOnDetail: true, placeHolder: 'Pick a topic' },
    );
    entry = pick?.entry;
  }
  if (!entry?.upstream?.length) {
    void vscode.window.showInformationMessage('No verified community skill is recorded for this topic. Use "Add Skill from GitHub Repository..." to install one by URL.');
    return;
  }
  const choice = await vscode.window.showQuickPick(
    entry.upstream.map((u) => ({ label: `$(github) ${u.repo}`, description: u.path || '(repository root)', detail: u.note, upstream: u })),
    { title: `Community versions of "${entry.title ?? entry.name}"`, matchOnDetail: true, placeHolder: 'Downloaded from GitHub into your project; review before relying on it' },
  );
  if (!choice) {
    return;
  }
  const client = new GitHubClient(service.githubToken);
  try {
    const ref = await client.resolveRef(choice.upstream.repo, choice.upstream.ref);
    const source: RemoteSource = { repo: choice.upstream.repo, path: choice.upstream.path, ref };
    const dir = choice.upstream.path.replace(/\/+$/, '');
    const skill: RemoteSkill = { source, id: dir ? path.posix.basename(dir) : choice.upstream.repo.split('/')[1], path: dir, ref };
    await installRemote(service, folder, client, [skill]);
  } catch (err) {
    void vscode.window.showErrorMessage(`Could not install community skill: ${(err as Error).message}`);
  }
}

async function createSkill(service: SkillService): Promise<void> {
  const folder = await service.pickWorkspace();
  if (!folder) {
    return;
  }
  const name = await vscode.window.showInputBox({
    title: 'New skill',
    prompt: 'Skill name (lowercase letters, digits and hyphens, e.g. "our-api-conventions")',
    validateInput: (v) => (isValidSkillName(v) ? undefined : 'Use lowercase letters, digits and single hyphens, max 64 chars'),
  });
  if (!name) {
    return;
  }
  const description = await vscode.window.showInputBox({
    title: 'New skill',
    prompt: 'One sentence: what the skill does and when an agent should use it',
    value: '',
    validateInput: (v) => (v.trim().length < 10 ? 'Write a full sentence so agents can decide when to load it' : undefined),
  });
  if (!description) {
    return;
  }
  const primary = service.targets[0];
  const dir = path.join(folder.uri.fsPath, primary.dir, name);
  if (await exists(dir)) {
    void vscode.window.showErrorMessage(`A skill named "${name}" already exists at ${primary.dir}.`);
    return;
  }
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'SKILL.md');
  await fs.writeFile(file, skillTemplate(name, description.trim()), 'utf8');
  const manifest: InstallManifest = { installedBy: 'agent-skills-manager', source: { type: 'local' }, installedAt: new Date().toISOString() };
  await fs.writeFile(path.join(dir, '.agent-skills.json'), JSON.stringify(manifest, null, 2) + '\n');
  // Link into secondary targets by reinstalling from the created folder.
  if (service.targets.length > 1) {
    await installSkillDir(dir, name, manifest, { workspaceRoot: folder.uri.fsPath, targets: service.targets, linkSecondary: service.linkSecondary, overwrite: true });
  }
  service.refresh();
  await vscode.window.showTextDocument(vscode.Uri.file(file));
}

async function openSkill(service: SkillService, node: TreeNode | undefined): Promise<void> {
  if (!node) {
    return;
  }
  let file: string | undefined;
  if (node.kind === 'installed') {
    file = path.join(node.skill.path, 'SKILL.md');
  } else if (node.kind === 'skill') {
    const folder = service.primaryWorkspace;
    if (folder) {
      const local = path.join(folder.uri.fsPath, service.targets[0].dir, node.entry.id, 'SKILL.md');
      if (await exists(local)) {
        file = local;
      }
    }
    file ??= path.join(service.skillSourceDir(node.entry), 'SKILL.md');
  }
  if (file) {
    await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(file)).then(undefined, async () => {
      await vscode.window.showTextDocument(vscode.Uri.file(file!));
    });
  }
}

async function selectTargets(service: SkillService): Promise<void> {
  const current = service.config.get<string[]>('targets', ['claude']);
  const items = [...Object.values(TARGETS), { key: 'custom', label: 'Custom directory', dir: service.config.get<string>('customTargetDirectory', '.agent-skills') }].map((t) => ({
    label: t.label,
    description: t.dir,
    picked: current.includes(t.key),
    key: t.key,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: 'Where should skills be installed?',
    placeHolder: 'The first selected target gets the files; the others are linked to it',
  });
  if (!picked?.length) {
    return;
  }
  // Preserve the existing primary when still selected so links do not flip direction.
  const keys = picked.map((p) => p.key);
  const ordered = [...current.filter((k) => keys.includes(k)), ...keys.filter((k) => !current.includes(k))];
  const hasWorkspace = !!vscode.workspace.workspaceFolders?.length;
  await service.config.update('targets', ordered, hasWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
}
