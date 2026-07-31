/**
 * CustomTextEditorProvider for .omocomp files.
 * Manages the document model for reusable component files.
 */

import * as vscode from 'vscode';
import { parseOmocomp, type OmocompFile } from '../types/omocomp';
import {
  type SerializedComponent,
  isSerializedNexus,
} from '../types/engine';
import { InspectorProvider } from '../panels/inspector';
import {
  findComponentById,
  findParentNexus,
  setNestedValue,
  getMaxId,
  countComponents,
  escapeHtml,
} from './omoscene-editor';

export class OmocompEditorProvider
  implements vscode.CustomTextEditorProvider
{
  public static readonly viewType = 'omosuen.omocompEditor';

  private activeDocument: vscode.TextDocument | null = null;
  private activeParsed: OmocompFile | null = null;

  constructor(
    private readonly inspector: InspectorProvider
  ) {}

  getActiveOmocomp(): OmocompFile | null {
    return this.activeParsed;
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this.activeDocument = document;
    this.activeParsed = parseOmocomp(document.getText());

    webviewPanel.webview.options = { enableScripts: true };
    this.updateWebview(webviewPanel, this.activeParsed);

    // Show component in Inspector
    if (this.activeParsed) {
      this.inspector.showComponent(this.activeParsed.component);
    }

    // Listen for document changes
    const changeSubscription = vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (e.document.uri.toString() === document.uri.toString()) {
          this.activeParsed = parseOmocomp(e.document.getText());
          this.updateWebview(webviewPanel, this.activeParsed);
        }
      }
    );

    webviewPanel.onDidDispose(() => {
      changeSubscription.dispose();
      if (this.activeDocument === document) {
        this.activeDocument = null;
        this.activeParsed = null;
      }
    });
  }

  /**
   * Update a component property within the .omocomp file.
   */
  async updateComponentProperty(
    componentId: number,
    property: string,
    value: unknown
  ): Promise<void> {
    if (!this.activeDocument || !this.activeParsed) {return;}

    const updated = JSON.parse(
      JSON.stringify(this.activeParsed)
    ) as OmocompFile;
    const component = findComponentById(updated.component, componentId);
    if (!component) {return;}

    setNestedValue(component, property, value);

    await this.writeDocument(updated);
  }

  /**
   * Add a child component (only valid when root is a nexus).
   */
  async addComponent(
    parentId: number,
    component: SerializedComponent
  ): Promise<void> {
    if (!this.activeDocument || !this.activeParsed) {return;}

    const updated = JSON.parse(
      JSON.stringify(this.activeParsed)
    ) as OmocompFile;
    const parent = findComponentById(updated.component, parentId);
    if (!parent || !isSerializedNexus(parent)) {return;}

    parent.components.push(component);

    await this.writeDocument(updated);
  }

  /**
   * Remove a component by ID.
   */
  async removeComponent(componentId: number): Promise<void> {
    if (!this.activeDocument || !this.activeParsed) {return;}

    const updated = JSON.parse(
      JSON.stringify(this.activeParsed)
    ) as OmocompFile;
    const parent = findParentNexus(updated.component, componentId);
    if (!parent) {return;}

    const idx = parent.components.findIndex((c) => c.id === componentId);
    if (idx === -1) {return;}
    parent.components.splice(idx, 1);

    await this.writeDocument(updated);
  }

  /**
   * Returns the next available component ID.
   */
  getNextId(): number {
    if (!this.activeParsed) {return 0;}
    return getMaxId(this.activeParsed.component) + 1;
  }

  private async writeDocument(updated: OmocompFile): Promise<void> {
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

  private updateWebview(
    panel: vscode.WebviewPanel,
    data: OmocompFile | null
  ): void {
    if (!data) {
      panel.webview.html = `<!DOCTYPE html>
<html><body style="color: #c8bfb0; font-family: 'IBM Plex Mono', monospace; padding: 20px; background: #0d0a07;">
<h2 style="color: #d4a843;">Invalid .omocomp file</h2>
<p>This file could not be parsed as a valid Omosuen component.</p>
</body></html>`;
      return;
    }

    const isNexus = isSerializedNexus(data.component);
    const componentCount = isNexus ? countComponents(data.component) : 1;

    panel.webview.html = `<!DOCTYPE html>
<html><body style="color: #c8bfb0; font-family: 'IBM Plex Mono', monospace; padding: 20px; background: #0d0a07;">
<h2 style="color: #d4a843;">${escapeHtml(data.name)}</h2>
<table style="font-size: 13px; border-collapse: collapse;">
  <tr><td style="padding: 2px 12px 2px 0; color: #7a7060;">Format</td><td>omocomp v${data.omocomp}</td></tr>
  <tr><td style="padding: 2px 12px 2px 0; color: #7a7060;">Engine</td><td>${escapeHtml(data.engine)}</td></tr>
  <tr><td style="padding: 2px 12px 2px 0; color: #7a7060;">Type</td><td>${escapeHtml(data.component.type)}</td></tr>
  ${isNexus ? `<tr><td style="padding: 2px 12px 2px 0; color: #7a7060;">Components</td><td>${componentCount}</td></tr>` : ''}
</table>
<p style="margin-top: 16px; color: #4a3e30; font-size: 12px;">
  Properties are shown in the Inspector panel.
</p>
</body></html>`;
  }
}
