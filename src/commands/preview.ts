/**
 * Preview commands — build with webpack, then launch dev server + browser.
 */

import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { OmosuenDevServer } from '../bridge/server';
import { OmosuenConsole } from '../panels/console';
import type { EditorMessage, PreviewLogPayload } from '../types/protocol';

let devServer: OmosuenDevServer | null = null;

/**
 * Returns the current dev server instance (if running)
 */
export function getDevServer(): OmosuenDevServer | null {
  return devServer;
}

/**
 * Run a shell command as a promise
 */
function runCommand(
  command: string,
  args: string[],
  cwd: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, shell: true }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Find the active .omoscene file — either the currently open one
 * or prompt the user to pick one from the workspace.
 */
async function resolveScenePath(
  workspaceRoot: vscode.Uri
): Promise<string | undefined> {
  // Check if the active editor has an .omoscene file
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor?.document.fileName.endsWith('.omoscene')) {
    return vscode.workspace.asRelativePath(
      activeEditor.document.uri,
      false
    );
  }

  // Check for visible custom editors with .omoscene
  for (const tabGroup of vscode.window.tabGroups.all) {
    for (const tab of tabGroup.tabs) {
      if (
        tab.input &&
        typeof tab.input === 'object' &&
        'uri' in tab.input
      ) {
        const uri = (tab.input as { uri: vscode.Uri }).uri;
        if (uri.fsPath.endsWith('.omoscene')) {
          return vscode.workspace.asRelativePath(uri, false);
        }
      }
    }
  }

  // Search workspace for .omoscene files and let user pick
  const files = await vscode.workspace.findFiles('**/*.omoscene');
  if (files.length === 0) {
    vscode.window.showErrorMessage(
      'No .omoscene files found in the workspace.'
    );
    return undefined;
  }

  if (files.length === 1) {
    return vscode.workspace.asRelativePath(files[0], false);
  }

  const picked = await vscode.window.showQuickPick(
    files.map((f) => ({
      label: vscode.workspace.asRelativePath(f, false),
      uri: f,
    })),
    {
      placeHolder: 'Select a scene to preview',
      title: 'Choose Scene',
    }
  );

  return picked?.label;
}

/**
 * Register preview commands
 */
export function registerPreviewCommands(
  context: vscode.ExtensionContext,
  console: OmosuenConsole,
  onMessage: (msg: EditorMessage) => void
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('omosuen.launchPreview', async () => {
      if (devServer?.isRunning) {
        vscode.window.showInformationMessage(
          'Omosuen preview is already running.'
        );
        return;
      }

      // Find the project root (workspace folder)
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage(
          'No workspace folder open. Open a project folder first.'
        );
        return;
      }

      const projectRoot = workspaceFolders[0].uri.fsPath;

      // Check if index.html exists
      const indexUri = vscode.Uri.joinPath(
        workspaceFolders[0].uri,
        'index.html'
      );
      try {
        await vscode.workspace.fs.stat(indexUri);
      } catch {
        vscode.window.showErrorMessage(
          'No index.html found in the workspace root. Cannot launch preview.'
        );
        return;
      }

      // Resolve which .omoscene to use
      const scenePath = await resolveScenePath(workspaceFolders[0].uri);
      if (!scenePath) {
        return;
      }

      // Check if webpack.config.js exists (TypeScript/webpack project)
      const webpackConfigUri = vscode.Uri.joinPath(
        workspaceFolders[0].uri,
        'webpack.config.js'
      );
      let hasWebpack = false;
      try {
        await vscode.workspace.fs.stat(webpackConfigUri);
        hasWebpack = true;
      } catch {
        // No webpack config — skip build step
      }

      // Build with webpack if available
      if (hasWebpack) {
        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Building project...',
              cancellable: false,
            },
            async (progress) => {
              progress.report({
                message: `Bundling scene: ${scenePath}`,
              });
              await runCommand(
                'npx',
                [
                  'webpack',
                  '--config',
                  'webpack.config.js',
                  '--env',
                  'mode=development',
                  '--env',
                  `scene=./${scenePath}`,
                ],
                projectRoot
              );
            }
          );
          console.info(`Built scene: ${scenePath}`);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err);
          console.error(`Build failed: ${message}`);
          vscode.window.showErrorMessage(
            `Webpack build failed: ${message}`
          );
          return;
        }
      }

      // Compile .omo.ts scripts to .omo.js for runtime dynamic import
      const scriptPattern = new vscode.RelativePattern(
        workspaceFolders[0],
        '**/*.omo.ts'
      );
      const scriptFiles = await vscode.workspace.findFiles(scriptPattern);
      if (scriptFiles.length > 0) {
        try {
          const relativePaths = scriptFiles.map(f =>
            vscode.workspace.asRelativePath(f, false)
          );
          await runCommand(
            'npx',
            ['esbuild', ...relativePaths, '--outdir=.', '--outbase=.', '--format=esm'],
            projectRoot
          );
          console.info(`Compiled ${scriptFiles.length} script(s)`);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err);
          console.error(`Script compilation failed: ${message}`);
          vscode.window.showErrorMessage(
            `Script compilation failed: ${message}`
          );
          return;
        }
      } else {
        console.info('No .omo.ts scripts found to compile');
      }

      const port = vscode.workspace
        .getConfiguration('omosuen')
        .get<number>('previewPort', 9421);

      devServer = new OmosuenDevServer(projectRoot, port);

      devServer.onMessage((msg) => {
        // Route log messages to console
        if (msg.type === 'preview:log') {
          console.handleLog(msg.payload as PreviewLogPayload);
        }

        // Forward all messages to the main handler
        onMessage(msg);
      });

      try {
        const url = await devServer.start();
        console.info(`Preview server started at ${url}`);
        console.show();

        // Set context for menu visibility
        vscode.commands.executeCommand(
          'setContext',
          'omosuen.previewRunning',
          true
        );

        // Open browser
        vscode.env.openExternal(vscode.Uri.parse(url));
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        console.error(`Failed to start preview: ${message}`);
        vscode.window.showErrorMessage(
          `Failed to start preview server: ${message}`
        );
        devServer = null;
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('omosuen.stopPreview', async () => {
      if (!devServer?.isRunning) {
        vscode.window.showInformationMessage('No preview is running.');
        return;
      }

      await devServer.stop();
      devServer = null;
      console.info('Preview server stopped');

      vscode.commands.executeCommand(
        'setContext',
        'omosuen.previewRunning',
        false
      );
      vscode.commands.executeCommand(
        'setContext',
        'omosuen.previewPaused',
        false
      );
    })
  );

  // ── Pause / Resume / Step / Perf Toggle ─────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('omosuen.pausePreview', () => {
      if (!devServer?.isRunning) { return; }
      devServer.broadcast('preview:pause', {});
      vscode.commands.executeCommand('setContext', 'omosuen.previewPaused', true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('omosuen.resumePreview', () => {
      if (!devServer?.isRunning) { return; }
      devServer.broadcast('preview:resume', {});
      vscode.commands.executeCommand('setContext', 'omosuen.previewPaused', false);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('omosuen.stepFrame', () => {
      if (!devServer?.isRunning) { return; }
      devServer.broadcast('preview:step', {});
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('omosuen.togglePerformanceOverlay', () => {
      if (!devServer?.isRunning) { return; }
      devServer.broadcast('preview:togglePerf', {});
    })
  );

}
