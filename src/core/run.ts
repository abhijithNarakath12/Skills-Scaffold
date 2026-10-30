export type RunMode = 'claude-terminal' | 'copilot-chat' | 'clipboard';

/** Chooses how to start an agent for the configured primary target. */
export function resolveRunMode(setting: string, primaryTarget: string): RunMode {
  if (setting === 'claude-terminal' || setting === 'copilot-chat' || setting === 'clipboard') {
    return setting;
  }
  if (primaryTarget === 'claude') {
    return 'claude-terminal';
  }
  if (primaryTarget === 'copilot') {
    return 'copilot-chat';
  }
  return 'clipboard';
}

/** Builds the shell command that starts Claude Code with an initial prompt. */
export function claudeCommand(prompt: string, platform: NodeJS.Platform = process.platform): string {
  const oneLine = prompt.replace(/\s+/g, ' ').trim();
  if (platform === 'win32') {
    return `claude "${oneLine.replace(/"/g, '\\"')}"`;
  }
  return `claude '${oneLine.replace(/'/g, `'\\''`)}'`;
}
