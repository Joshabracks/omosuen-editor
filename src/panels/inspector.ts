/**
 * Inspector panel — WebviewViewProvider that renders property editors
 * for the currently selected component.
 */

import * as vscode from 'vscode';
import type { SerializedComponent, COMPONENT_TYPE } from '../types/engine';
import { getSchemaForType, type PropertySchema } from '../schema/component-schemas';

export class InspectorProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'omosuen.inspector';

  private webviewView: vscode.WebviewView | undefined;
  private currentComponent: SerializedComponent | null = null;
  private _onPropertyChanged:
    | ((componentId: number, property: string, value: unknown) => void)
    | null = null;

  constructor(private readonly extensionUri: vscode.Uri) {}

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
      this.webviewView.webview.postMessage({
        command: 'showComponent',
        component,
        schema: component
          ? getSchemaForType(component.type as COMPONENT_TYPE)
          : [],
      });
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource};">
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
