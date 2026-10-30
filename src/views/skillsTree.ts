import * as path from 'path';
import * as vscode from 'vscode';
import { CATEGORY_LABELS, CATEGORY_ORDER, groupByCategory } from '../core/catalog';
import type { CatalogEntry, InstalledSkill, SkillCategory } from '../core/types';
import type { SkillService } from '../service';

export type TreeNode = CategoryNode | SkillNode | InstalledNode | InfoNode;

export interface CategoryNode {
  kind: 'category';
  category: SkillCategory;
  entries: CatalogEntry[];
}

export interface SkillNode {
  kind: 'skill';
  entry: CatalogEntry;
  installed: boolean;
  reasons?: string[];
}

export interface InstalledNode {
  kind: 'installed';
  skill: InstalledSkill;
  entry?: CatalogEntry;
  outdated: boolean;
}

export interface InfoNode {
  kind: 'info';
  label: string;
  description?: string;
}

abstract class BaseProvider implements vscode.TreeDataProvider<TreeNode> {
  protected readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(protected readonly service: SkillService) {
    service.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  abstract getChildren(element?: TreeNode): Promise<TreeNode[]>;

  getTreeItem(node: TreeNode): vscode.TreeItem {
    switch (node.kind) {
      case 'category': {
        const item = new vscode.TreeItem(CATEGORY_LABELS[node.category], vscode.TreeItemCollapsibleState.Expanded);
        item.description = `${node.entries.length}`;
        item.contextValue = 'category';
        item.iconPath = new vscode.ThemeIcon(categoryIcon(node.category));
        return item;
      }
      case 'skill': {
        const item = new vscode.TreeItem(node.entry.title ?? node.entry.name, vscode.TreeItemCollapsibleState.None);
        item.description = node.installed ? 'installed' : node.reasons?.length ? node.reasons.join(', ') : undefined;
        item.tooltip = new vscode.MarkdownString(`**${node.entry.name}**\n\n${node.entry.description}` + (node.reasons?.length ? `\n\nDetected: ${node.reasons.join(', ')}` : '') + (node.entry.upstream?.length ? `\n\nCommunity versions: ${node.entry.upstream.map((u) => u.repo).join(', ')}` : ''));
        item.contextValue = (node.installed ? 'skill-catalog-installed' : 'skill-available') + (node.entry.upstream?.length ? ' has-upstream' : '');
        item.iconPath = new vscode.ThemeIcon(node.installed ? 'check' : 'book');
        item.command = { command: 'agentSkills.openSkill', title: 'Open SKILL.md', arguments: [node] };
        return item;
      }
      case 'installed': {
        const item = new vscode.TreeItem(node.skill.name, vscode.TreeItemCollapsibleState.None);
        const parts: string[] = [];
        if (node.skill.isSymlink) {
          parts.push('link');
        }
        if (node.outdated) {
          parts.push('update available');
        }
        if (!node.skill.manifest) {
          parts.push('custom');
        }
        item.description = parts.join(' · ');
        item.tooltip = new vscode.MarkdownString(`**${node.skill.name}**\n\n${node.skill.description}\n\n\`${node.skill.path}\``);
        item.contextValue = 'skill-installed' + (node.entry?.upstream?.length ? ' has-upstream' : '');
        item.iconPath = new vscode.ThemeIcon(node.outdated ? 'arrow-circle-up' : 'verified');
        item.resourceUri = vscode.Uri.file(path.join(node.skill.path, 'SKILL.md'));
        item.command = { command: 'agentSkills.openSkill', title: 'Open SKILL.md', arguments: [node] };
        return item;
      }
      case 'info': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.description = node.description;
        item.iconPath = new vscode.ThemeIcon('info');
        return item;
      }
    }
  }
}

function categoryIcon(category: SkillCategory): string {
  switch (category) {
    case 'generic':
      return 'checklist';
    case 'languages':
      return 'symbol-keyword';
    case 'frameworks':
      return 'layers';
    case 'libraries':
      return 'library';
    case 'tooling':
      return 'tools';
  }
}

export class CatalogProvider extends BaseProvider {
  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    const catalog = await this.service.getCatalog();
    if (!element) {
      const groups = groupByCategory(catalog.skills);
      return CATEGORY_ORDER.filter((c) => (groups.get(c) ?? []).length > 0).map((category) => ({ kind: 'category', category, entries: groups.get(category)! }));
    }
    if (element.kind === 'category') {
      const folder = this.service.primaryWorkspace;
      const installed = new Set(folder ? (await this.service.getInstalled(folder)).map((s) => s.id) : []);
      return element.entries.map((entry) => ({ kind: 'skill', entry, installed: installed.has(entry.id) }));
    }
    return [];
  }
}

export class RecommendedProvider extends BaseProvider {
  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (element) {
      return [];
    }
    const folder = this.service.primaryWorkspace;
    if (!folder) {
      return [];
    }
    const [recs, installed] = await Promise.all([this.service.getRecommendations(folder), this.service.getInstalled(folder)]);
    const installedIds = new Set(installed.map((s) => s.id));
    const catalog = await this.service.getCatalog();
    const generic = catalog.skills.filter((s) => s.category === 'generic');
    const nodes: TreeNode[] = recs.map((r) => ({ kind: 'skill', entry: r.entry, installed: installedIds.has(r.entry.id), reasons: r.reasons }));
    if (!nodes.length) {
      nodes.push({ kind: 'info', label: 'No stack detected yet', description: 'add a dependency manifest or browse the catalog' });
    }
    for (const g of generic) {
      nodes.push({ kind: 'skill', entry: g, installed: installedIds.has(g.id), reasons: ['workflow'] });
    }
    return nodes;
  }
}

export class InstalledProvider extends BaseProvider {
  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (element) {
      return [];
    }
    const folder = this.service.primaryWorkspace;
    if (!folder) {
      return [];
    }
    const [installed, catalog] = await Promise.all([this.service.getInstalled(folder), this.service.getCatalog()]);
    const byId = new Map(catalog.skills.map((e) => [e.id, e]));
    const primary = this.service.targets[0];
    const seen = new Set<string>();
    const nodes: TreeNode[] = [];
    // Show each skill once, preferring the primary target's copy.
    for (const skill of [...installed].sort((a, b) => (a.target === primary.key ? -1 : 1) - (b.target === primary.key ? -1 : 1))) {
      if (seen.has(skill.id)) {
        continue;
      }
      seen.add(skill.id);
      const entry = byId.get(skill.id);
      const outdated = !!entry && skill.manifest?.source.type === 'bundled' && skill.manifest.source.version !== entry.version;
      nodes.push({ kind: 'installed', skill, entry, outdated });
    }
    return nodes;
  }
}
