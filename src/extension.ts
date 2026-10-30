import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { SkillService } from './service';
import { CatalogProvider, InstalledProvider, RecommendedProvider } from './views/skillsTree';

export function activate(context: vscode.ExtensionContext): void {
  const service = new SkillService(context);
  context.subscriptions.push(service);
  service.log(`Agent Skills Manager ${context.extension.packageJSON.version} activated. Targets: ${service.targets.map((t) => t.dir).join(', ')}`);

  const catalog = new CatalogProvider(service);
  const recommended = new RecommendedProvider(service);
  const installed = new InstalledProvider(service);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('agentSkills.catalog', catalog),
    vscode.window.registerTreeDataProvider('agentSkills.recommended', recommended),
    vscode.window.registerTreeDataProvider('agentSkills.installed', installed),
    ...registerCommands(service),
  );

  void suggestRecommended(context, service);
}

export function deactivate(): void {
  // nothing to clean up: disposables are handled by the extension context
}

/** One-time nudge per workspace when a recognisable stack has no skills installed yet. */
async function suggestRecommended(context: vscode.ExtensionContext, service: SkillService): Promise<void> {
  const folder = service.primaryWorkspace;
  if (!folder || !service.config.get<boolean>('recommendOnOpen', true)) {
    return;
  }
  const key = `suggested:${folder.uri.fsPath}`;
  if (context.workspaceState.get<boolean>(key)) {
    return;
  }
  try {
    const [recs, installedSkills] = await Promise.all([service.getRecommendations(folder), service.getInstalled(folder)]);
    service.log(`Detected in ${folder.name}: ${recs.length ? recs.map((r) => `${r.entry.id} (${r.reasons.join(', ')})`).join('; ') : 'nothing recognisable'}`);
    service.log(`Installed skills in ${folder.name}: ${installedSkills.length ? installedSkills.map((s) => `${s.id}@${s.target}`).join(', ') : 'none'}`);
    if (!recs.length || installedSkills.length) {
      return;
    }
    await context.workspaceState.update(key, true);
    const names = recs.slice(0, 4).map((r) => r.entry.title ?? r.entry.name).join(', ');
    const choice = await vscode.window.showInformationMessage(
      `Agent Skills: this project looks like it uses ${names}${recs.length > 4 ? ' and more' : ''}. Add matching skills for your AI agents?`,
      'Add Recommended',
      'Browse',
      "Don't ask again",
    );
    if (choice === 'Add Recommended') {
      await vscode.commands.executeCommand('agentSkills.addRecommended');
    } else if (choice === 'Browse') {
      await vscode.commands.executeCommand('agentSkills.addSkills');
    } else if (choice === "Don't ask again") {
      await service.config.update('recommendOnOpen', false, vscode.ConfigurationTarget.Global);
    }
  } catch (err) {
    service.log(`Detection failed: ${(err as Error).message}`);
  }
}
