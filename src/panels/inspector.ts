/**
 * Inspector panel — WebviewViewProvider that renders property editors
 * for the currently selected component.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { SerializedComponent, COMPONENT_TYPE } from '../types/engine';
import { isSerializedNexus } from '../types/engine';
import { getSchemaForType, type PropertySchema } from '../schema/component-schemas';

export class InspectorProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'omosuen.inspector';

  private webviewView: vscode.WebviewView | undefined;
  private currentComponent: SerializedComponent | null = null;
  private sceneRoot: SerializedComponent | null = null;
  private _onPropertyChanged:
    | ((componentId: number, property: string, value: unknown) => void)
    | null = null;

  constructor(private readonly extensionUri: vscode.Uri) {}

  /**
   * Update the scene root for validation context (e.g. sprite texture map lookups)
   */
  setScene(scene: SerializedComponent | null): void {
    this.sceneRoot = scene;
  }

  /**
   * Register a handler for when the user changes a property in the inspector
   */
  onPropertyChanged(
    handler: (componentId: number, property: string, value: unknown) => void
  ): void {
    this._onPropertyChanged = handler;
  }

  /**
   * Show properties for a specific component
   */
  showComponent(component: SerializedComponent | null): void {
    this.currentComponent = component;
    if (this.webviewView) {
      const msg: Record<string, unknown> = {
        command: 'showComponent',
        component,
        schema: component
          ? getSchemaForType(component.type as COMPONENT_TYPE)
          : [],
      };

      // Compute sprite validation context
      if (component && component.type === 'sprite' && this.sceneRoot) {
        msg.spriteContext = this.computeSpriteContext(component);
      }

      // Compute camera validation context
      if (component && component.type === 'camera' && this.sceneRoot) {
        msg.cameraContext = this.computeCameraContext(component);
      }

      // Compute animation-controller validation context
      if (component && component.type === 'animation-controller' && this.sceneRoot) {
        msg.animationControllerContext = this.computeAnimationControllerContext(component);
      }

      // Compute cell-map info context
      if (component && component.type === 'cell-map') {
        msg.cellMapContext = this.computeCellMapContext(component);
      }

      // Compute texture-map file existence context (async)
      if (component && component.type === 'texture-map') {
        this.computeTextureMapContext(component).then((ctx) => {
          msg.textureMapContext = ctx;
          this.webviewView!.webview.postMessage(msg);
        });
        return;
      }

      this.webviewView.webview.postMessage(msg);
    }
  }

  private computeSpriteContext(sprite: SerializedComponent): {
    hasSiblingTransform: boolean;
    keyValidation: Record<string, { exists: boolean; frameCount: number }>;
  } {
    const comp = sprite as Record<string, unknown>;
    const tmKeys = (comp.textureMapKeys as Record<string, string>) || {};
    const channels = ['albedo', 'normal', 'material', 'emission'];

    // Find parent nexus containing this sprite
    let hasSiblingTransform = false;
    if (this.sceneRoot && sprite.id !== undefined) {
      const parent = this.findParentNexus(this.sceneRoot, sprite.id);
      if (parent && isSerializedNexus(parent)) {
        hasSiblingTransform = parent.components.some((c) => c.type === 'transform');
      }
    }

    // Validate each texture map key
    const keyValidation: Record<string, { exists: boolean; frameCount: number }> = {};
    for (const channel of channels) {
      const key = tmKeys[channel] || '';
      if (!key) {
        keyValidation[channel] = { exists: false, frameCount: 0 };
        continue;
      }
      // Search scene for matching texture-map component
      const tm = this.sceneRoot ? this.findTextureMapByKey(this.sceneRoot, key) : null;
      if (tm) {
        keyValidation[channel] = { exists: true, frameCount: this.computeFrameCount(tm) };
      } else {
        keyValidation[channel] = { exists: false, frameCount: 0 };
      }
    }

    return { hasSiblingTransform, keyValidation };
  }

  private computeCameraContext(camera: SerializedComponent): {
    hasSiblingTransform: boolean;
  } {
    let hasSiblingTransform = false;
    if (this.sceneRoot && camera.id !== undefined) {
      const parent = this.findParentNexus(this.sceneRoot, camera.id);
      if (parent && isSerializedNexus(parent)) {
        hasSiblingTransform = parent.components.some((c) => c.type === 'transform');
      }
    }
    return { hasSiblingTransform };
  }

  private computeAnimationControllerContext(ac: SerializedComponent): {
    hasSiblingSprite: boolean;
  } {
    let hasSiblingSprite = false;
    if (this.sceneRoot && ac.id !== undefined) {
      const parent = this.findParentNexus(this.sceneRoot, ac.id);
      if (parent && isSerializedNexus(parent)) {
        hasSiblingSprite = parent.components.some((c) => c.type === 'sprite');
      }
    }
    return { hasSiblingSprite };
  }

  private computeCellMapContext(cm: SerializedComponent): {
    materialCount: number;
    mapDimensions: string;
  } {
    const comp = cm as Record<string, unknown>;
    const materials = (comp.materials as unknown[]) || [];
    const mapSize = comp.mapSize as { x?: number; y?: number; z?: number } | undefined;
    const dims = mapSize
      ? `${mapSize.x || 0}\u00d7${mapSize.y || 0}\u00d7${mapSize.z || 0}`
      : '0\u00d70\u00d70';
    return { materialCount: materials.length, mapDimensions: dims };
  }

  private findParentNexus(
    root: SerializedComponent,
    childId: number
  ): SerializedComponent | null {
    if (!isSerializedNexus(root)) {return null;}
    for (const child of root.components) {
      if (child.id === childId) {return root;}
      if (isSerializedNexus(child)) {
        const found = this.findParentNexus(child, childId);
        if (found) {return found;}
      }
    }
    return null;
  }

  private findTextureMapByKey(
    component: SerializedComponent,
    key: string
  ): Record<string, unknown> | null {
    if (component.type === 'texture-map') {
      const tm = component as Record<string, unknown>;
      if ((tm.textureMapKey as string) === key) {return tm;}
    }
    if (isSerializedNexus(component)) {
      for (const child of component.components) {
        const found = this.findTextureMapByKey(child, key);
        if (found) {return found;}
      }
    }
    return null;
  }

  private computeFrameCount(tm: Record<string, unknown>): number {
    const imageType = tm.imageType as { mode?: string; cols?: number; rows?: number; cellCount?: number; frames?: unknown[] } | null | undefined;
    if (!imageType) {return 1;}
    if (imageType.mode === 'grid') {
      return imageType.cellCount ?? ((imageType.cols || 1) * (imageType.rows || 1));
    }
    if (imageType.mode === 'framemap' && Array.isArray(imageType.frames)) {
      return imageType.frames.length;
    }
    return 1;
  }

  private async handleBrowseFile(
    property: string,
    acceptedTypes: string[]
  ): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {return;}

    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    const filters: Record<string, string[]> = {};
    if (acceptedTypes.length > 0) {
      filters['Accepted Files'] = acceptedTypes;
    }
    filters['All Files'] = ['*'];

    const result = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters,
      defaultUri: vscode.Uri.file(workspaceRoot),
    });

    if (!result || result.length === 0) {return;}

    const selectedPath = result[0].fsPath;
    const relativePath = path.relative(workspaceRoot, selectedPath).replace(/\\/g, '/');

    // Send the selected path back to the webview
    if (this.webviewView) {
      this.webviewView.webview.postMessage({
        command: 'fileSelected',
        property,
        value: relativePath,
      });
    }

    // Also trigger property change to update the document
    if (this._onPropertyChanged && this.currentComponent?.id !== undefined) {
      this._onPropertyChanged(this.currentComponent.id, property, relativePath);
    }
  }

  private async computeTextureMapContext(
    component: SerializedComponent
  ): Promise<{ fileExists: boolean }> {
    const comp = component as Record<string, unknown>;
    const filePath = (comp.filePath as string) || '';

    if (!filePath) {
      return { fileExists: true }; // empty path is not a warning
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return { fileExists: false };
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(workspaceRoot, filePath);

    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(absPath));
      return { fileExists: true };
    } catch {
      return { fileExists: false };
    }
  }

  /**
   * Show a multi-selection summary instead of individual properties
   */
  showMultiSelection(count: number): void {
    this.currentComponent = null;
    if (this.webviewView) {
      this.webviewView.webview.postMessage({
        command: 'showMultiSelection',
        count,
      });
    }
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message) => {
      if (
        message.command === 'propertyChanged' &&
        this._onPropertyChanged &&
        this.currentComponent?.id !== undefined
      ) {
        this._onPropertyChanged(
          this.currentComponent.id,
          message.property,
          message.value
        );
      } else if (message.command === 'executeCommand' && message.vsCommand) {
        vscode.commands.executeCommand(
          message.vsCommand as string,
          this.currentComponent
        );
      } else if (message.command === 'browseFile') {
        this.handleBrowseFile(
          message.property as string,
          (message.acceptedTypes as string[]) || []
        );
      }
    });

    // If we already have a component queued, show it
    if (this.currentComponent) {
      this.showComponent(this.currentComponent);
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'inspector', 'styles.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'inspector', 'main.js')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${stylesUri}">
  <title>Inspector</title>
</head>
<body>
  <div id="inspector-root">
    <div id="empty-state">
      <p>Select a component in the Scene Tree to inspect its properties.</p>
    </div>
    <div id="component-header" style="display:none;">
      <span id="component-icon"></span>
      <span id="component-name"></span>
      <span id="component-type"></span>
    </div>
    <div id="properties-container"></div>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
