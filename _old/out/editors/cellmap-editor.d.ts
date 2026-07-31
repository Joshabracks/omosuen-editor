/**
 * Cell-Map Voxel Editor — WebviewPanel that loads the Omosuen engine
 * for native WebGL2 rendering of the cell map, with overlay UI for editing.
 */
import * as vscode from 'vscode';
import type { OmosceneEditorProvider } from './omoscene-editor';
import type { InspectorProvider } from '../panels/inspector';
import { type SerializedComponent } from '../types/engine';
/**
 * Forwards a property change to the cell-map editor webview (no-op if not open).
 */
export declare function updateCellMapProperty(property: string, value: unknown): void;
/**
 * Opens (or focuses) the voxel map editor for a cell-map component.
 */
export declare function openCellMapEditor(context: vscode.ExtensionContext, component: SerializedComponent, omosceneEditor: OmosceneEditorProvider, inspectorProvider: InspectorProvider): Promise<void>;
