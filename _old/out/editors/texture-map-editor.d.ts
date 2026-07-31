/**
 * Texture-Map Frame Editor — WebviewPanel for visually configuring
 * frame extraction (GridConfig or FrameMap) on a source image.
 */
import * as vscode from 'vscode';
import type { OmosceneEditorProvider } from './omoscene-editor';
import type { InspectorProvider } from '../panels/inspector';
import type { SerializedComponent } from '../types/engine';
/**
 * Opens (or focuses) the texture-map frame editor for the given component.
 */
export declare function openFrameEditor(context: vscode.ExtensionContext, component: SerializedComponent, omosceneEditor: OmosceneEditorProvider, inspectorProvider: InspectorProvider): void;
