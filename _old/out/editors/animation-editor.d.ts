/**
 * Animation Editor — WebviewPanel for visually building sprite animations.
 * Follows the same pattern as texture-map-editor.ts.
 */
import * as vscode from 'vscode';
import type { OmosceneEditorProvider } from './omoscene-editor';
import type { InspectorProvider } from '../panels/inspector';
import { type SerializedComponent } from '../types/engine';
/**
 * Opens (or focuses) the animation editor for the given animation-controller component.
 */
export declare function openAnimationEditor(context: vscode.ExtensionContext, component: SerializedComponent, omosceneEditor: OmosceneEditorProvider, inspectorProvider: InspectorProvider): void;
