/**
 * Cell-Map Materials Editor — WebviewPanel for managing cell-map material definitions.
 * Each material maps 4 texture channels (albedo, normal, emission, material) to scene texture-map keys.
 */
import * as vscode from 'vscode';
import type { OmosceneEditorProvider } from './omoscene-editor';
import type { InspectorProvider } from '../panels/inspector';
import { type SerializedComponent } from '../types/engine';
/**
 * Opens (or focuses) the materials editor for a cell-map component.
 */
export declare function openCellMapMaterialsEditor(context: vscode.ExtensionContext, component: SerializedComponent, omosceneEditor: OmosceneEditorProvider, inspectorProvider: InspectorProvider): void;
