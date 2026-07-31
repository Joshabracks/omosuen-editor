/**
 * CRUD commands for components in the Scene Tree.
 * Add, Delete, Duplicate, and Rename components.
 */
import * as vscode from 'vscode';
import type { COMPONENT_TYPE, SerializedComponent } from '../types/engine';
import type { OmosceneEditorProvider } from '../editors/omoscene-editor';
import type { SceneTreeProvider } from '../panels/scene-tree';
import { ComponentTreeItem } from '../panels/scene-tree';
import type { InspectorProvider } from '../panels/inspector';
export declare const ALL_COMPONENT_TYPES: COMPONENT_TYPE[];
export declare function registerCrudCommands(context: vscode.ExtensionContext, sceneTree: SceneTreeProvider, inspector: InspectorProvider, omosceneEditor: OmosceneEditorProvider, treeView: vscode.TreeView<ComponentTreeItem>): void;
export declare function reassignIds(component: SerializedComponent, nextId: () => number): void;
export declare function computeGlobalUniquenessFlags(scene: SerializedComponent | null): Map<string, boolean>;
export declare function createDefaultComponent(type: COMPONENT_TYPE, name: string, id: number): SerializedComponent;
