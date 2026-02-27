/**
 * Omosuen Editor — VS Code Extension Entry Point
 *
 * Registers all providers, commands, and panels for the editor.
 * Phase 1 MVP: Scene Tree, Inspector, .omoscene editor, preview server, console.
 */

import * as vscode from 'vscode';
import { SceneTreeProvider, ComponentTreeItem, setExtensionUri } from './panels/scene-tree';
import { InspectorProvider } from './panels/inspector';
import { OmosuenConsole } from './panels/console';
import { AssetBrowserProvider } from './panels/asset-browser';
import { OmosceneEditorProvider, findComponentById, findParentNexus } from './editors/omoscene-editor';
import { OmocompEditorProvider } from './editors/omocomp-editor';
import { isSerializedNexus, type SerializedNexus, type SerializedComponent } from './types/engine';
import {
  registerPreviewCommands,
  getDevServer,
} from './commands/preview';
import { registerCreateProjectCommand } from './commands/create-project';
import { registerCrudCommands, reassignIds, ALL_COMPONENT_TYPES, createDefaultComponent, computeGlobalUniquenessFlags } from './commands/component-crud';
import { registerExportCommand } from './commands/scene-export';
import { registerBuildTasks } from './tasks/build';
import { openFrameEditor } from './editors/texture-map-editor';
import { openAnimationEditor } from './editors/animation-editor';
import { openCellMapMaterialsEditor } from './editors/cellmap-materials-editor';
import { openCellMapEditor } from './editors/cellmap-editor';
import type {
  EditorMessage,
  ComponentSelectedPayload,
  ComponentChangedPayload,
  PreviewReadyPayload,
  PreviewPauseStatePayload,
  EditorCameraStatePayload,
} from './types/protocol';
import { parseOmoscene } from './types/omoscene';
import { parseOmocomp, createOmocomp } from './types/omocomp';
import { OmosuenCompletionProvider } from './language/completion';
import { OmosuenHoverProvider } from './language/hover';
import { OmosuenDefinitionProvider } from './language/definition';
import { WorkspaceDiscovery } from './language/discovery';
import { registerDiagnostics } from './language/diagnostics';

export function activate(context: vscode.ExtensionContext): void {
  // ── Console ─────────────────────────────────────────────────────

  const omoConsole = new OmosuenConsole();
  context.subscriptions.push({ dispose: () => omoConsole.dispose() });

  omoConsole.info('Omosuen Editor activating...');

  // ── Icons ─────────────────────────────────────────────────────────

  setExtensionUri(context.extensionUri);

  // ── Scene Tree ──────────────────────────────────────────────────

  const sceneTree = new SceneTreeProvider();
  const treeView = vscode.window.createTreeView('omosuen.sceneTree', {
    treeDataProvider: sceneTree,
    showCollapseAll: true,
    dragAndDropController: sceneTree,
    canSelectMany: true,
  });
  context.subscriptions.push(treeView);

  // ── Context keys for global uniqueness ─────────────────────────

  sceneTree.onSceneChanged((scene) => {
    const flags = computeGlobalUniquenessFlags(scene);
    for (const [type, exists] of flags) {
      vscode.commands.executeCommand('setContext', `omosuen.exists.${type}`, exists);
    }
  });

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

  // ── .omocomp Editor ────────────────────────────────────────────

  const omocompEditor = new OmocompEditorProvider(inspector);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      OmocompEditorProvider.viewType,
      omocompEditor,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    )
  );

  // ── Asset Browser ─────────────────────────────────────────────

  const assetBrowser = new AssetBrowserProvider();
  const assetTreeView = vscode.window.createTreeView('omosuen.assetBrowser', {
    treeDataProvider: assetBrowser,
    showCollapseAll: true,
    dragAndDropController: assetBrowser,
  });
  context.subscriptions.push(assetTreeView);
  context.subscriptions.push({ dispose: () => assetBrowser.dispose() });

  // Initialize file watcher
  assetBrowser.initialize();

  // ── Wire up selection sync ──────────────────────────────────────

  // Tree -> Inspector + Preview
  sceneTree.onDidSelectComponent((component) => {
    inspector.showComponent(component);

    // Forward selection to editor canvas for camera rect highlighting
    if (component.id !== undefined) {
      let entityId = component.id;
      if (component.type !== 'nexus') {
        const scene = omosceneEditor.getActiveScene();
        if (scene) {
          const parent = findParentNexus(scene.scene, component.id);
          if (parent && parent.id !== undefined) {
            entityId = parent.id;
          }
        }
      }
      omosceneEditor.selectEntity(entityId);
    }

    // Notify preview of selection
    const server = getDevServer();
    if (server?.isRunning && component.id !== undefined) {
      server.broadcast('component:select', {
        componentId: component.id,
      });
    }
  });

  // Tree item click handler (supports multi-select)
  treeView.onDidChangeSelection((e) => {
    const items = e.selection.filter(
      (s): s is ComponentTreeItem => s instanceof ComponentTreeItem
    );
    if (items.length === 1) {
      sceneTree.selectItem(items[0]);
    } else if (items.length > 1) {
      inspector.showMultiSelection(items.length);
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
        // Restore saved camera state
        const camState = omosceneEditor.getCameraState();
        if (camState) {
          const server = getDevServer();
          if (server?.isRunning) {
            server.broadcast('editor:setCameraState', camState);
          }
        }
        break;
      }

      case 'component:selected': {
        const payload = msg.payload as ComponentSelectedPayload;
        // Find the component in the current scene and select it
        const scene = omosceneEditor.getActiveScene();
        if (scene) {
          const component = findComponentById(
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

      case 'preview:pauseState': {
        const pausePayload = msg.payload as PreviewPauseStatePayload;
        vscode.commands.executeCommand(
          'setContext',
          'omosuen.previewPaused',
          pausePayload.paused
        );
        break;
      }

      case 'component:changed': {
        const changedPayload = msg.payload as ComponentChangedPayload;
        omosceneEditor.updateComponentProperty(
          changedPayload.componentId,
          changedPayload.property,
          changedPayload.value
        );
        break;
      }

      case 'editor:cameraState': {
        const camPayload = msg.payload as EditorCameraStatePayload;
        omosceneEditor.updateCameraState(camPayload.panX, camPayload.panY, camPayload.zoom);
        break;
      }

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

  // ── Create Project command ────────────────────────────────────

  registerCreateProjectCommand(context);

  // ── CRUD commands (add / delete / duplicate / rename) ─────────

  registerCrudCommands(context, sceneTree, inspector, omosceneEditor, treeView);

  // ── Drag-drop reparenting ────────────────────────────────────

  sceneTree.onMoveComponent((componentId, newParentId, index) => {
    omosceneEditor.moveComponent(componentId, newParentId, index);
  });

  // ── Move Up / Move Down commands ─────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'omosuen.moveComponentUp',
      (item: ComponentTreeItem) => {
        if (item.parentId === undefined) {return;}
        const root = sceneTree.getSceneRoot();
        if (!root) {return;}

        const parent = findComponentById(root, item.parentId);
        if (!parent || !isSerializedNexus(parent)) {return;}

        const siblings = (parent as SerializedNexus).components;
        const idx = siblings.findIndex((c) => c.id === item.component.id);
        if (idx <= 0) {return;}

        omosceneEditor.moveComponent(item.component.id!, item.parentId, idx - 1);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'omosuen.moveComponentDown',
      (item: ComponentTreeItem) => {
        if (item.parentId === undefined) {return;}
        const root = sceneTree.getSceneRoot();
        if (!root) {return;}

        const parent = findComponentById(root, item.parentId);
        if (!parent || !isSerializedNexus(parent)) {return;}

        const siblings = (parent as SerializedNexus).components;
        const idx = siblings.findIndex((c) => c.id === item.component.id);
        if (idx === -1 || idx >= siblings.length - 1) {return;}

        omosceneEditor.moveComponent(item.component.id!, item.parentId, idx + 1);
      }
    )
  );

  // ── Asset Browser: .omocomp drop into Scene Tree ──────────────

  sceneTree.onDropOmocompFile(async (fileUri, targetNexusId) => {
    const uri = vscode.Uri.parse(fileUri);
    const content = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(content).toString('utf-8');
    const omocomp = parseOmocomp(text);
    if (!omocomp) {
      vscode.window.showErrorMessage('Failed to parse .omocomp file.');
      return;
    }

    // Deep clone and reassign IDs to prevent conflicts
    const component = JSON.parse(JSON.stringify(omocomp.component)) as SerializedComponent;
    let nextId = omosceneEditor.getNextId();
    reassignIds(component, () => nextId++);

    await omosceneEditor.addComponent(targetNexusId, component);
  });

  // ── Asset Browser commands ────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('omosuen.openAsset', (uri: vscode.Uri) => {
      const fsPath = uri.fsPath;
      if (fsPath.endsWith('.omoscene')) {
        vscode.commands.executeCommand('vscode.openWith', uri, OmosceneEditorProvider.viewType);
      } else if (fsPath.endsWith('.omocomp')) {
        vscode.commands.executeCommand('vscode.openWith', uri, OmocompEditorProvider.viewType);
      } else {
        vscode.commands.executeCommand('vscode.open', uri);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('omosuen.newOmocomp', async () => {
      const picked = await vscode.window.showQuickPick(
        ALL_COMPONENT_TYPES.map((type) => ({ label: type })),
        {
          placeHolder: 'Select component type',
          title: 'New Component File',
        }
      );
      if (!picked) {return;}

      const name = await vscode.window.showInputBox({
        prompt: `Name for new ${picked.label} component`,
        value: picked.label,
        validateInput: (v) => (v.trim() ? null : 'Name cannot be empty'),
      });
      if (!name) {return;}

      const component = createDefaultComponent(picked.label as typeof ALL_COMPONENT_TYPES[number], name, 0);
      const omocomp = createOmocomp(name, component);

      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {return;}

      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
          `${workspaceFolders[0].uri.fsPath}/${slug}.omocomp`
        ),
        filters: { 'Omosuen Component': ['omocomp'] },
        title: 'Save Component File',
      });
      if (!saveUri) {return;}

      await vscode.workspace.fs.writeFile(
        saveUri,
        Buffer.from(JSON.stringify(omocomp, null, 2), 'utf-8')
      );

      vscode.commands.executeCommand('vscode.openWith', saveUri, OmocompEditorProvider.viewType);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('omosuen.refreshAssetBrowser', () => {
      assetBrowser.refresh();
    })
  );

  // ── Frame Editor command ───────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'omosuen.openFrameEditor',
      (component?: SerializedComponent) => {
        if (!component) {
          vscode.window.showWarningMessage(
            'Select a texture-map component first.'
          );
          return;
        }
        openFrameEditor(context, component, omosceneEditor, inspector);
      }
    )
  );

  // ── Animation Editor command ─────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'omosuen.openAnimationEditor',
      (component?: SerializedComponent) => {
        if (!component) {
          vscode.window.showWarningMessage(
            'Select an animation-controller component first.'
          );
          return;
        }
        openAnimationEditor(context, component, omosceneEditor, inspector);
      }
    )
  );

  // ── Cell-Map Materials Editor command ─────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'omosuen.openCellMapMaterials',
      (component?: SerializedComponent) => {
        if (!component) {
          vscode.window.showWarningMessage(
            'Select a cell-map component first.'
          );
          return;
        }
        openCellMapMaterialsEditor(context, component, omosceneEditor, inspector);
      }
    )
  );

  // ── Cell-Map Voxel Editor command ───────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'omosuen.openCellMapEditor',
      async (component?: SerializedComponent) => {
        if (!component) {
          vscode.window.showWarningMessage(
            'Select a cell-map component first.'
          );
          return;
        }
        await openCellMapEditor(context, component, omosceneEditor, inspector);
      }
    )
  );

  // ── Search Scene Tree command ────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('omosuen.searchSceneTree', async () => {
      const root = sceneTree.getSceneRoot();
      if (!root) {
        vscode.window.showInformationMessage('No scene loaded.');
        return;
      }

      const items = flattenTree(root, []);
      const picked = await vscode.window.showQuickPick(
        items.map((item) => ({
          label: item.name,
          description: item.type,
          detail: item.path,
          _component: item.component,
        })),
        {
          placeHolder: 'Search components by name or type',
          title: 'Search Scene Tree',
          matchOnDescription: true,
          matchOnDetail: true,
        }
      );
      if (!picked) { return; }

      inspector.showComponent(picked._component);
    })
  );

  // ── Export Runtime Scene command ──────────────────────────────

  registerExportCommand(context);

  // ── Build tasks ────────────────────────────────────────────────

  registerBuildTasks(context);

  // ── Language Intelligence ─────────────────────────────────────

  const tsJsSelector: vscode.DocumentSelector = [
    { language: 'typescript', scheme: 'file' },
    { language: 'javascript', scheme: 'file' },
  ];

  const discovery = new WorkspaceDiscovery();
  context.subscriptions.push(discovery);
  discovery.scanAllFiles();

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      tsJsSelector,
      new OmosuenCompletionProvider(discovery),
      "'", '"', '{', ',', ':'
    ),
    vscode.languages.registerHoverProvider(
      tsJsSelector,
      new OmosuenHoverProvider(discovery)
    ),
    vscode.languages.registerDefinitionProvider(
      tsJsSelector,
      new OmosuenDefinitionProvider(discovery)
    ),
    registerDiagnostics(context, discovery),
  );

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

// ── Helpers ─────────────────────────────────────────────────────

interface FlatComponent {
  name: string;
  type: string;
  path: string;
  component: SerializedComponent;
}

function flattenTree(
  node: SerializedComponent,
  ancestors: string[]
): FlatComponent[] {
  const path = [...ancestors, node.name].join(' > ');
  const result: FlatComponent[] = [{
    name: node.name,
    type: node.type,
    path,
    component: node,
  }];

  if (isSerializedNexus(node)) {
    for (const child of (node as SerializedNexus).components) {
      result.push(...flattenTree(child, [...ancestors, node.name]));
    }
  }

  return result;
}

export function deactivate(): void {
  // Dev server cleanup happens via preview command dispose
  const server = getDevServer();
  if (server?.isRunning) {
    server.stop();
  }
}

