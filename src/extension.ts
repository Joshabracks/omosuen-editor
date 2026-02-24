/**
 * Omosuen Editor — VS Code Extension Entry Point
 *
 * Registers all providers, commands, and panels for the editor.
 * Phase 1 MVP: Scene Tree, Inspector, .omoscene editor, preview server, console.
 */

import * as vscode from 'vscode';
import { SceneTreeProvider, ComponentTreeItem } from './panels/scene-tree';
import { InspectorProvider } from './panels/inspector';
import { OmosuenConsole } from './panels/console';
import { OmosceneEditorProvider } from './editors/omoscene-editor';
import {
  registerPreviewCommands,
  getDevServer,
} from './commands/preview';
import type {
  EditorMessage,
  ComponentSelectedPayload,
  PreviewReadyPayload,
} from './types/protocol';
import {
  type SerializedComponent,
  isSerializedNexus,
} from './types/engine';
import { parseOmoscene } from './types/omoscene';

export function activate(context: vscode.ExtensionContext): void {
  // ── Console ─────────────────────────────────────────────────────

  const omoConsole = new OmosuenConsole();
  context.subscriptions.push({ dispose: () => omoConsole.dispose() });

  omoConsole.info('Omosuen Editor activating...');

  // ── Scene Tree ──────────────────────────────────────────────────

  const sceneTree = new SceneTreeProvider();
  const treeView = vscode.window.createTreeView('omosuen.sceneTree', {
    treeDataProvider: sceneTree,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // ── Inspector ───────────────────────────────────────────────────

  const inspector = new InspectorProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      InspectorProvider.viewType,
      inspector,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // ── .omoscene Editor ────────────────────────────────────────────

  const omosceneEditor = new OmosceneEditorProvider(sceneTree, inspector);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      OmosceneEditorProvider.viewType,
      omosceneEditor,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    )
  );

  // ── Wire up selection sync ──────────────────────────────────────

  // Tree -> Inspector + Preview
  sceneTree.onDidSelectComponent((component) => {
    inspector.showComponent(component);

    // Notify preview of selection
    const server = getDevServer();
    if (server?.isRunning && component.id !== undefined) {
      server.broadcast('component:select', {
        componentId: component.id,
      });
    }
  });

  // Tree item click handler
  treeView.onDidChangeSelection((e) => {
    if (e.selection.length > 0) {
      const item = e.selection[0];
      if (item instanceof ComponentTreeItem) {
        sceneTree.selectItem(item);
      }
    }
  });

  // Inspector -> Document + Preview
  inspector.onPropertyChanged((componentId, property, value) => {
    omosceneEditor.updateComponentProperty(componentId, property, value);
  });

  // ── Preview message handler ─────────────────────────────────────

  function handlePreviewMessage(msg: EditorMessage): void {
    switch (msg.type) {
      case 'preview:ready': {
        const payload = msg.payload as PreviewReadyPayload;
        omoConsole.info(
          `Preview connected — engine v${payload.engineVersion}, contract v${payload.contractVersion}`
        );
        break;
      }

      case 'component:selected': {
        const payload = msg.payload as ComponentSelectedPayload;
        // Find the component in the current scene and select it
        const scene = omosceneEditor.getActiveScene();
        if (scene) {
          const component = findComponentByIdInScene(
            scene.scene,
            payload.componentId
          );
          if (component) {
            inspector.showComponent(component);
          }
        }
        break;
      }

      case 'preview:fps':
        // Could display in status bar in the future
        break;

      case 'preview:error': {
        const errPayload = msg.payload as { message?: string };
        omoConsole.error(
          `Preview error: ${errPayload.message ?? 'Unknown error'}`
        );
        break;
      }

      // preview:log is handled in preview.ts before reaching here
    }
  }

  // ── Preview commands ────────────────────────────────────────────

  registerPreviewCommands(context, omoConsole, handlePreviewMessage);

  // ── Refresh command ─────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('omosuen.refreshSceneTree', () => {
      // Re-read the active .omoscene document
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.fileName.endsWith('.omoscene')) {
        const parsed = parseOmoscene(editor.document.getText());
        if (parsed) {
          sceneTree.setScene(parsed.scene);
        }
      }
    })
  );

  // ── Auto-load scene from active .omoscene file ──────────────────

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.fileName.endsWith('.omoscene')) {
        const parsed = parseOmoscene(editor.document.getText());
        if (parsed) {
          sceneTree.setScene(parsed.scene);
        }
      }
    })
  );

  // Check if there's already an active .omoscene file
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && activeEditor.document.fileName.endsWith('.omoscene')) {
    const parsed = parseOmoscene(activeEditor.document.getText());
    if (parsed) {
      sceneTree.setScene(parsed.scene);
    }
  }

  omoConsole.info('Omosuen Editor activated');
}

export function deactivate(): void {
  // Dev server cleanup happens via preview command dispose
  const server = getDevServer();
  if (server?.isRunning) {
    server.stop();
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function findComponentByIdInScene(
  component: SerializedComponent,
  id: number
): SerializedComponent | null {
  if (component.id === id) {return component;}
  if (isSerializedNexus(component)) {
    for (const child of component.components) {
      const found = findComponentByIdInScene(child, id);
      if (found) {return found;}
    }
  }
  return null;
}
