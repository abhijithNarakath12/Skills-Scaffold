import * as path from 'path';
import * as vscode from 'vscode';
import { loadCatalog } from './core/catalog';
import { detectStack, recommend, type DetectedStack, type Recommendation } from './core/detect';
import { listInstalled } from './core/installer';
import { resolveTargets, type TargetInfo } from './core/targets';
import type { Catalog, CatalogEntry, InstalledSkill } from './core/types';
import type { RemoteSource } from './core/remote';

/** Central state shared by commands and views: catalog, config, detection cache. */
export class SkillService implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private catalog: Catalog | undefined;
  private stackCache = new Map<string, Promise<DetectedStack>>();
  private readonly disposables: vscode.Disposable[] = [];
  readonly output = vscode.window.createOutputChannel('Agent Skills');

  constructor(readonly context: vscode.ExtensionContext) {
    this.disposables.push(
      this.output,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('agentSkills')) {
          this.refresh();
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()),
    );
    const watcher = vscode.workspace.createFileSystemWatcher('**/{package.json,requirements*.txt,pyproject.toml,go.mod,Cargo.toml,pom.xml,build.gradle,build.gradle.kts,Gemfile,composer.json,*.csproj,pubspec.yaml,Package.swift}');
    const invalidate = () => {
      this.stackCache.clear();
      this._onDidChange.fire();
    };
    watcher.onDidChange(invalidate);
    watcher.onDidCreate(invalidate);
    watcher.onDidDelete(invalidate);
    this.disposables.push(watcher);
  }

  get skillsRoot(): string {
    return path.join(this.context.extensionPath, 'skills');
  }

  get config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('agentSkills');
  }

  get targets(): TargetInfo[] {
    return resolveTargets(this.config.get<string[]>('targets', ['claude']), this.config.get<string>('customTargetDirectory', '.agent-skills'));
  }

  get linkSecondary(): boolean {
    return this.config.get<boolean>('linkSecondaryTargets', true);
  }

  get remoteSources(): RemoteSource[] {
    return this.config.get<RemoteSource[]>('remoteSources', []);
  }

  get githubToken(): string | undefined {
    return this.config.get<string>('githubToken') || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
  }

  /** The workspace folder skills are managed for; asks when there are several. */
  async pickWorkspace(): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      void vscode.window.showWarningMessage('Open a folder to manage its agent skills.');
      return undefined;
    }
    if (folders.length === 1) {
      return folders[0];
    }
    return vscode.window.showWorkspaceFolderPick({ placeHolder: 'Select the project to add skills to' });
  }

  get primaryWorkspace(): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.workspaceFolders?.[0];
  }

  async getCatalog(): Promise<Catalog> {
    if (!this.catalog) {
      this.catalog = await loadCatalog(this.skillsRoot);
    }
    return this.catalog;
  }

  async getEntry(id: string): Promise<CatalogEntry | undefined> {
    return (await this.getCatalog()).skills.find((s) => s.id === id);
  }

  skillSourceDir(entry: CatalogEntry): string {
    return path.join(this.skillsRoot, entry.dir);
  }

  getStack(folder: vscode.WorkspaceFolder): Promise<DetectedStack> {
    const key = folder.uri.fsPath;
    let p = this.stackCache.get(key);
    if (!p) {
      p = detectStack(key);
      this.stackCache.set(key, p);
    }
    return p;
  }

  async getRecommendations(folder: vscode.WorkspaceFolder): Promise<Recommendation[]> {
    const [catalog, stack] = await Promise.all([this.getCatalog(), this.getStack(folder)]);
    return recommend(catalog.skills, stack);
  }

  async getInstalled(folder: vscode.WorkspaceFolder): Promise<InstalledSkill[]> {
    return listInstalled(folder.uri.fsPath, this.targets);
  }

  refresh(): void {
    this.stackCache.clear();
    this._onDidChange.fire();
  }

  log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this._onDidChange.dispose();
  }
}
