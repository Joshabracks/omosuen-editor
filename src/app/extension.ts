import * as vscode from 'vscode';
import { readOmoscene, writeOmoscene } from '../omoscene/fs.js';
import { registerPanel } from '../panel/base.js';
import { registerCommands } from './commands.js';
import {
  createDocumentRegistry,
  followActiveController,
} from './document-registry.js';
import { registerNewProjectCommand } from './new-project-command.js';
import { registerPreviewLauncherCommand } from './preview-launcher-command.js';
import { registerSceneEditorProvider } from './scene-editor-provider.js';
import { registerSceneTreeCommands } from './scene-tree-commands.js';
import { registerSceneTreeProvider } from './scene-tree-provider.js';
import { registerAnimationEditor } from '../scene/animation-editor/host.js';
import { registerTextureMapEditor } from '../scene/texture-map-editor/host.js';
import { registerFilePickerCommand } from './file-picker-command.js';

export function activate(context: vscode.ExtensionContext): void {
  // Phase 0 sanity command — still useful for confirming activation.
  const hello = vscode.commands.registerCommand('omosuen.hello', () => {
    void vscode.window.showInformationMessage(
      'Omosuen editor extension is alive.',
    );
  });
  context.subscriptions.push(hello);

  // Phase 6.1: per-tab document registry. Each `.omoscene` URI gets its
  // own controller; sidebars follow whichever is active.
  const registry = createDocumentRegistry({
    readFile: (uri) => readOmoscene(uri),
    writeFile: (uri, file) => writeOmoscene(uri, file),
  });
  context.subscriptions.push({ dispose: () => registry.dispose() });

  registerCommands(context, registry);
  registerNewProjectCommand(context);
  registerPreviewLauncherCommand(context, registry);
  registerSceneEditorProvider(context, registry);
  registerAnimationEditor(context, registry);
  registerTextureMapEditor(context, registry);
  registerFilePickerCommand(context, registry);
  registerSceneTreeCommands(context, registry);

  // Phase 8.1: forward `command:invoke` messages from any panel through
  // to `vscode.commands.executeCommand` so schema-declared inspector
  // action buttons actually fire their commands. Subscribe per
  // controller as each is created; message listeners auto-clean when
  // the controller disposes.
  registry.onControllerCreated((controller) => {
    controller.editorState.subscribeMessages((msg) => {
      if (msg.kind !== 'command:invoke') return;
      void vscode.commands.executeCommand(msg.command, ...msg.args);
    });
  });

  // Scene Tree — native VS Code `TreeDataProvider`. Runs in the
  // extension host so context menus and drag ghosts render in the
  // editor chrome (unbounded by sidebar width), while host-side
  // reads of `editorState` keep it in lockstep with the inspector
  // via `DocumentController.dispatchFromHost` + store subscriptions.
  registerSceneTreeProvider(context, registry);

  // Remaining sidebars (Inspector) — `followActiveController` rebinds
  // their bridge when the active tab changes and hydrates them with the
  // new document via the existing `registerPanel` scene:load emission.
  const inspector = registerPanel(context, {
    id: 'omosuen.inspector',
    title: 'Inspector',
    kind: 'view',
    webviewEntryPath: 'inspector.js',
    wireOutgoing: (bridge) => followActiveController(bridge, registry),
  });
  context.subscriptions.push({ dispose: () => inspector.dispose() });

  // Post-8 gap-fill: Project view hosts the "Create New Project…"
  // button (and future project-settings UI). No controller binding —
  // the panel doesn't depend on which scene is active.
  const project = registerPanel(context, {
    id: 'omosuen.project',
    title: 'Project',
    kind: 'view',
    webviewEntryPath: 'project.js',
  });
  context.subscriptions.push({ dispose: () => project.dispose() });
}

export function deactivate(): void {
  // no-op
}
