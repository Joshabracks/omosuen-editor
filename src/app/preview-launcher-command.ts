/**
 * "Omosuen: Preview Scene" command (Phase 9.2 + 9.3).
 *
 * Orchestrates the flow from a user press to a running browser tab:
 *
 *   1. Resolve the active `.omoscene` via the document registry.
 *   2. Walk up from the scene URI until a `package.json` is found — that
 *      directory is the project root (mirrors `_old`'s resolution).
 *   3. Confirm `webpack.config.js` exists. If not, error with a pointer
 *      to `Omosuen: New Project…` (which now scaffolds it, Phase 9.1).
 *   4. Build the project via `npx webpack --env mode=development
 *      --env scene=<relative-path>`, streaming output to the "Omosuen
 *      Preview" OutputChannel. Non-zero exit aborts.
 *   5. Start the preview HTTP server + WebSocket bridge (Phase 9.2/9.3)
 *      bound to `omosuen.previewPort` (default 9421).
 *   6. Register the WS bridge with the active document controller so
 *      inspector edits fan out live; attach a raw listener for
 *      `preview:ready` and `preview:log` so they land in the output
 *      channel.
 *   7. `vscode.env.openExternal` to the preview URL.
 *
 * Only one preview is alive at a time — starting a new one disposes the
 * prior.
 */

import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import type { Bridge } from '../bridge/index.js';
import { createWebsocketHostBridge } from '../bridge/websocket-host-bridge.js';
import type { EditorMessage } from '../protocol/index.js';
import type { DocumentRegistry } from './document-registry.js';
import {
  startPreviewServer,
  type PreviewServerHandle,
} from './preview-server.js';

interface PreviewSession {
  readonly server: PreviewServerHandle;
  readonly bridge: Bridge;
  readonly unregisterPanel: () => void;
  readonly unsubscribeBridge: () => void;
  readonly outputChannel: vscode.OutputChannel;
  dispose(): Promise<void>;
}

let activeSession: PreviewSession | null = null;

export function registerPreviewLauncherCommand(
  ctx: vscode.ExtensionContext,
  registry: DocumentRegistry,
): void {
  const outputChannel = vscode.window.createOutputChannel('Omosuen Preview');
  ctx.subscriptions.push(outputChannel);

  const cmd = vscode.commands.registerCommand('omosuen.previewScene', () =>
    runPreviewFlow(registry, outputChannel, ctx),
  );
  ctx.subscriptions.push(cmd);

  ctx.subscriptions.push({
    dispose(): void {
      if (activeSession !== null) {
        void activeSession.dispose();
        activeSession = null;
      }
    },
  });
}

async function runPreviewFlow(
  registry: DocumentRegistry,
  outputChannel: vscode.OutputChannel,
  ctx: vscode.ExtensionContext,
): Promise<void> {
  const controller = registry.activeController.get();
  if (controller === null || controller.uri === null) {
    void vscode.window.showErrorMessage(
      'Omosuen: open an .omoscene file before running Preview Scene.',
    );
    return;
  }
  const sceneUri = controller.uri;

  const projectRoot = await findProjectRoot(sceneUri);
  if (projectRoot === null) {
    void vscode.window.showErrorMessage(
      'Omosuen: no package.json found walking up from the active scene. Scaffold a project via "Omosuen: New Project…" first.',
    );
    return;
  }

  const webpackConfigUri = vscode.Uri.joinPath(
    projectRoot,
    'webpack.config.js',
  );
  if (!(await uriExists(webpackConfigUri))) {
    void vscode.window.showErrorMessage(
      'Omosuen: webpack.config.js missing in the project root. Re-scaffold via "Omosuen: New Project…" or add one manually.',
    );
    return;
  }

  const port = vscode.workspace
    .getConfiguration('omosuen')
    .get<number>('previewPort', 9421);

  if (activeSession !== null) {
    outputChannel.appendLine('[preview] disposing prior preview session');
    await activeSession.dispose();
    activeSession = null;
  }

  outputChannel.show(true);
  outputChannel.appendLine(`[preview] project root: ${projectRoot.fsPath}`);
  outputChannel.appendLine(`[preview] scene: ${sceneUri.fsPath}`);

  const relativeScenePath = toRelativePosix(
    projectRoot.fsPath,
    sceneUri.fsPath,
  );
  const buildOk = await runWebpackBuild(
    projectRoot.fsPath,
    relativeScenePath,
    outputChannel,
  );
  if (!buildOk) {
    void vscode.window.showErrorMessage(
      'Omosuen: webpack build failed. See the "Omosuen Preview" output channel.',
    );
    return;
  }

  let server: PreviewServerHandle;
  try {
    server = await startPreviewServer({
      projectRoot: projectRoot.fsPath,
      port,
      overlayBundlePath: overlayBundleFsPath(ctx),
      log: (line) => outputChannel.appendLine(line),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[preview] failed to start server: ${msg}`);
    void vscode.window.showErrorMessage(
      `Omosuen: failed to start preview server — ${msg}`,
    );
    return;
  }

  const bridge = createWebsocketHostBridge({
    httpServer: server.httpServer,
    onError: (err) => outputChannel.appendLine(`[preview][ws] ${err.message}`),
  });
  const unsubscribeBridge = bridge.onMessage((msg) =>
    onPreviewMessage(msg, outputChannel),
  );
  const unregisterPanel = controller.registerPanel(bridge);

  activeSession = {
    server,
    bridge,
    unregisterPanel,
    unsubscribeBridge,
    outputChannel,
    async dispose(): Promise<void> {
      unsubscribeBridge();
      unregisterPanel();
      bridge.dispose();
      await server.dispose();
    },
  };

  outputChannel.appendLine(`[preview] opening ${server.url}`);
  void vscode.env.openExternal(vscode.Uri.parse(server.url));
}

function onPreviewMessage(
  msg: EditorMessage,
  outputChannel: vscode.OutputChannel,
): void {
  if (msg.kind === 'preview:ready') {
    outputChannel.appendLine(
      `[preview] game connected — engine ${msg.engineVersion}`,
    );
    return;
  }
  if (msg.kind === 'preview:log') {
    outputChannel.appendLine(`[preview][${msg.level}] ${msg.message}`);
    return;
  }
  // Everything else flows through the document-controller broker; no
  // direct handling needed here.
}

async function runWebpackBuild(
  cwd: string,
  relativeScenePath: string,
  outputChannel: vscode.OutputChannel,
): Promise<boolean> {
  return new Promise((resolve) => {
    outputChannel.appendLine(
      `[preview] npx webpack --config webpack.config.js --env mode=development --env scene=${relativeScenePath}`,
    );
    const child = spawn(
      'npx',
      [
        'webpack',
        '--config',
        'webpack.config.js',
        '--env',
        'mode=development',
        '--env',
        `scene=${relativeScenePath}`,
      ],
      {
        cwd,
        shell: true,
      },
    );
    child.stdout?.on('data', (chunk: Buffer) => {
      outputChannel.append(chunk.toString('utf8'));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      outputChannel.append(chunk.toString('utf8'));
    });
    child.on('error', (err) => {
      outputChannel.appendLine(`[preview] spawn error: ${err.message}`);
      resolve(false);
    });
    child.on('close', (code) => {
      outputChannel.appendLine(`[preview] webpack exited with code ${code}`);
      resolve(code === 0);
    });
  });
}

async function findProjectRoot(
  sceneUri: vscode.Uri,
): Promise<vscode.Uri | null> {
  let current = parentDir(sceneUri);
  for (let i = 0; i < 20 && current !== null; i += 1) {
    const pkg = vscode.Uri.joinPath(current, 'package.json');
    if (await uriExists(pkg)) return current;
    const parent = parentDir(current);
    if (parent === null || parent.toString() === current.toString()) break;
    current = parent;
  }
  return null;
}

function parentDir(uri: vscode.Uri): vscode.Uri | null {
  const parts = uri.path.split('/');
  if (parts.length <= 1) return null;
  parts.pop();
  const parentPath = parts.join('/');
  if (parentPath === '' || parentPath === '/') return null;
  return uri.with({ path: parentPath });
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function toRelativePosix(root: string, child: string): string {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedChild = child.replace(/\\/g, '/');
  if (normalizedChild.toLowerCase().startsWith(normalizedRoot.toLowerCase())) {
    const slice = normalizedChild
      .slice(normalizedRoot.length)
      .replace(/^\/+/, '');
    return `./${slice}`;
  }
  return normalizedChild;
}

function overlayBundleFsPath(ctx: vscode.ExtensionContext): string {
  return vscode.Uri.joinPath(ctx.extensionUri, 'dist', 'preview-overlay.js')
    .fsPath;
}
