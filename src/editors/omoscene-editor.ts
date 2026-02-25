/**
 * CustomTextEditorProvider for .omoscene files.
 * Manages the document model and wires up the scene tree,
 * inspector, and preview sync.
 */

import * as vscode from 'vscode';
import { parseOmoscene, type OmosceneFile } from '../types/omoscene';
import {
  type SerializedComponent,
  type SerializedNexus,
  isSerializedNexus,
} from '../types/engine';
import { SceneTreeProvider } from '../panels/scene-tree';
import { InspectorProvider } from '../panels/inspector';
import { getDevServer } from '../commands/preview';

export class OmosceneEditorProvider
  implements vscode.CustomTextEditorProvider
{
  public static readonly viewType = 'omosuen.omosceneEditor';

  private activeDocument: vscode.TextDocument | null = null;
  private activeParsed: OmosceneFile | null = null;

  constructor(
    private readonly sceneTree: SceneTreeProvider,
    private readonly inspector: InspectorProvider
  ) {}

  /**
   * Get the currently parsed scene data
   */
  getActiveScene(): OmosceneFile | null {
    return this.activeParsed;
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this.activeDocument = document;

    // Parse the document
    this.activeParsed = parseOmoscene(document.getText());

    // Update scene tree
    if (this.activeParsed) {
      this.sceneTree.setScene(this.activeParsed.scene);
    }

    // Set up the webview as a simple document viewer/status panel
    webviewPanel.webview.options = { enableScripts: true };
    this.updateWebview(webviewPanel, this.activeParsed);

    // Listen for document changes
    const changeSubscription = vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (e.document.uri.toString() === document.uri.toString()) {
          this.activeParsed = parseOmoscene(e.document.getText());
          if (this.activeParsed) {
            this.sceneTree.setScene(this.activeParsed.scene);
          }
          this.updateWebview(webviewPanel, this.activeParsed);
        }
      }
    );

    webviewPanel.onDidDispose(() => {
      changeSubscription.dispose();
      if (this.activeDocument === document) {
        this.activeDocument = null;
        this.activeParsed = null;
        this.sceneTree.setScene(null);
        this.inspector.showComponent(null);
      }
    });
  }

  /**
   * Add a component as a child of the given parent nexus.
   */
  async addComponent(
    parentId: number,
    component: SerializedComponent
  ): Promise<void> {
    if (!this.activeDocument || !this.activeParsed) {return;}

    const updated = JSON.parse(
      JSON.stringify(this.activeParsed)
    ) as OmosceneFile;
    const parent = findComponentById(updated.scene, parentId);
    if (!parent || !isSerializedNexus(parent)) {return;}

    parent.components.push(component);

    await this.writeDocument(updated);

    const server = getDevServer();
    if (server?.isRunning) {
      server.broadcast('component:add', { parentId, component });
    }
  }

  /**
   * Remove a component by ID from the scene.
   */
  async removeComponent(componentId: number): Promise<void> {
    if (!this.activeDocument || !this.activeParsed) {return;}

    const updated = JSON.parse(
      JSON.stringify(this.activeParsed)
    ) as OmosceneFile;
    const parent = findParentNexus(updated.scene, componentId);
    if (!parent) {return;}

    const idx = parent.components.findIndex((c) => c.id === componentId);
    if (idx === -1) {return;}
    parent.components.splice(idx, 1);

    await this.writeDocument(updated);

    const server = getDevServer();
    if (server?.isRunning) {
      server.broadcast('component:remove', { componentId });
    }
  }

  /**
   * Returns the next available component ID (max existing + 1).
   */
  getNextId(): number {
    if (!this.activeParsed) {return 0;}
    return getMaxId(this.activeParsed.scene) + 1;
  }

  /**
   * Move a component to a new parent at a specific index.
   */
  async moveComponent(
    componentId: number,
    newParentId: number,
    index: number
  ): Promise<void> {
    if (!this.activeDocument || !this.activeParsed) {return;}

    const updated = JSON.parse(
      JSON.stringify(this.activeParsed)
    ) as OmosceneFile;

    // Find and remove from old parent
    const oldParent = findParentNexus(updated.scene, componentId);
    if (!oldParent) {return;}

    const oldIdx = oldParent.components.findIndex((c) => c.id === componentId);
    if (oldIdx === -1) {return;}

    const [component] = oldParent.components.splice(oldIdx, 1);

    // Find new parent
    const newParent = findComponentById(updated.scene, newParentId);
    if (!newParent || !isSerializedNexus(newParent)) {return;}

    // Adjust index when moving within the same parent
    let insertIdx = index;
    if (oldParent.id === newParent.id && oldIdx < index) {
      insertIdx--;
    }

    // Clamp to valid range
    insertIdx = Math.max(0, Math.min(insertIdx, newParent.components.length));

    newParent.components.splice(insertIdx, 0, component);

    await this.writeDocument(updated);

    const server = getDevServer();
    if (server?.isRunning) {
      server.broadcast('component:move', {
        componentId,
        oldParentId: oldParent.id,
        newParentId,
        index: insertIdx,
      });
    }
  }

  /**
   * Write an updated OmosceneFile back to the active document.
   */
  private async writeDocument(updated: OmosceneFile): Promise<void> {
    if (!this.activeDocument) {return;}

    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      this.activeDocument.positionAt(0),
      this.activeDocument.positionAt(this.activeDocument.getText().length)
    );
    edit.replace(
      this.activeDocument.uri,
      fullRange,
      JSON.stringify(updated, null, 2)
    );
    await vscode.workspace.applyEdit(edit);
  }

  /**
   * Update a component property in the document
   */
  async updateComponentProperty(
    componentId: number,
    property: string,
    value: unknown
  ): Promise<void> {
    if (!this.activeDocument || !this.activeParsed) {return;}

    // Deep clone and modify
    const updated = JSON.parse(
      JSON.stringify(this.activeParsed)
    ) as OmosceneFile;
    const component = findComponentById(updated.scene, componentId);
    if (!component) {return;}

    // Handle dotted paths (e.g., "textureMapKeys.albedo")
    setNestedValue(component, property, value);

    await this.writeDocument(updated);

    // Send update to preview if running
    const server = getDevServer();
    if (server?.isRunning) {
      server.broadcast('component:update', {
        componentId,
        property,
        value,
      });
    }
  }

  private updateWebview(
    panel: vscode.WebviewPanel,
    data: OmosceneFile | null
  ): void {
    if (!data) {
      panel.webview.html = `<!DOCTYPE html>
<html><body style="color: var(--vscode-foreground); font-family: var(--vscode-font-family); padding: 20px;">
<h2>Invalid .omoscene file</h2>
<p>This file could not be parsed as a valid Omosuen scene.</p>
</body></html>`;
      return;
    }

    const componentCount = countComponents(data.scene);

    panel.webview.html = `<!DOCTYPE html>
<html><body style="color: var(--vscode-foreground); font-family: var(--vscode-font-family); padding: 20px;">
<h2>${escapeHtml(data.name)}</h2>
<table style="font-size: 13px; border-collapse: collapse;">
  <tr><td style="padding: 2px 12px 2px 0; opacity: 0.7;">Format</td><td>omoscene v${data.omoscene}</td></tr>
  <tr><td style="padding: 2px 12px 2px 0; opacity: 0.7;">Engine</td><td>${escapeHtml(data.engine)}</td></tr>
  <tr><td style="padding: 2px 12px 2px 0; opacity: 0.7;">Root</td><td>${escapeHtml(data.scene.name)} (${data.scene.type})</td></tr>
  <tr><td style="padding: 2px 12px 2px 0; opacity: 0.7;">Components</td><td>${componentCount}</td></tr>
</table>
<p style="margin-top: 16px; opacity: 0.6; font-size: 12px;">
  Use the Scene Tree panel to browse and select components.<br>
  Use the Inspector panel to edit properties.
</p>
</body></html>`;
  }
}

// ── Helpers ─────────────────────────────────────────────────────

export function findComponentById(
  component: SerializedComponent,
  id: number
): SerializedComponent | null {
  if (component.id === id) {return component;}
  if (isSerializedNexus(component)) {
    for (const child of component.components) {
      const found = findComponentById(child, id);
      if (found) {return found;}
    }
  }
  return null;
}

export function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (
      typeof current[parts[i]] !== 'object' ||
      current[parts[i]] === null
    ) {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

export function findParentNexus(
  root: SerializedComponent,
  childId: number
): SerializedNexus | null {
  if (!isSerializedNexus(root)) {return null;}
  for (const child of root.components) {
    if (child.id === childId) {return root;}
    if (isSerializedNexus(child)) {
      const found = findParentNexus(child, childId);
      if (found) {return found;}
    }
  }
  return null;
}

export function getMaxId(component: SerializedComponent): number {
  let max = component.id ?? -1;
  if (isSerializedNexus(component)) {
    for (const child of component.components) {
      const childMax = getMaxId(child);
      if (childMax > max) {max = childMax;}
    }
  }
  return max;
}

export function countComponents(component: SerializedComponent): number {
  let count = 1;
  if (isSerializedNexus(component)) {
    for (const child of component.components) {
      count += countComponents(child);
    }
  }
  return count;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
