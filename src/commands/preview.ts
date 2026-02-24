/**
 * Preview commands — launch/stop the browser preview with dev server.
 */

import * as vscode from 'vscode';
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
    })
  );
}
