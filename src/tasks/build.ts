/**
 * Task Provider for Omosuen webpack build/watch tasks.
 * Registers three tasks: Build (Dev), Build (Prod), and Watch.
 */

import * as vscode from 'vscode';

interface OmosuenTaskDefinition extends vscode.TaskDefinition {
  task: 'build:dev' | 'build:prod' | 'watch';
}

const TASK_CONFIGS: Array<{
  task: OmosuenTaskDefinition['task'];
  label: string;
  args: string;
  isBackground: boolean;
}> = [
  {
    task: 'build:dev',
    label: 'Omosuen: Build (Dev)',
    args: '--config webpack.config.js --env mode=development',
    isBackground: false,
  },
  {
    task: 'build:prod',
    label: 'Omosuen: Build (Prod)',
    args: '--config webpack.config.js --env mode=production',
    isBackground: false,
  },
  {
    task: 'watch',
    label: 'Omosuen: Watch',
    args: '--config webpack.config.js --env mode=development --watch',
    isBackground: true,
  },
];

class OmosuenTaskProvider implements vscode.TaskProvider {
  async provideTasks(): Promise<vscode.Task[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) { return []; }

    // Only provide tasks if the workspace has a webpack config
    const configs = await vscode.workspace.findFiles(
      'webpack.config.{js,ts,mjs,cjs}',
      '**/node_modules/**',
      1
    );
    if (configs.length === 0) { return []; }

    return TASK_CONFIGS.map((cfg) => this.createTask(cfg, workspaceFolder));
  }

  resolveTask(task: vscode.Task): vscode.Task | undefined {
    const definition = task.definition as OmosuenTaskDefinition;
    const config = TASK_CONFIGS.find((c) => c.task === definition.task);
    if (!config) { return undefined; }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) { return undefined; }

    return this.createTask(config, workspaceFolder);
  }

  private createTask(
    cfg: typeof TASK_CONFIGS[number],
    workspaceFolder: vscode.WorkspaceFolder
  ): vscode.Task {
    const definition: OmosuenTaskDefinition = {
      type: 'omosuen',
      task: cfg.task,
    };

    const execution = new vscode.ShellExecution(`npx webpack ${cfg.args}`, {
      cwd: workspaceFolder.uri.fsPath,
    });

    const task = new vscode.Task(
      definition,
      workspaceFolder,
      cfg.label,
      'omosuen',
      execution
    );

    task.group = vscode.TaskGroup.Build;
    task.isBackground = cfg.isBackground;

    return task;
  }
}

export function registerBuildTasks(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.tasks.registerTaskProvider('omosuen', new OmosuenTaskProvider())
  );
}
