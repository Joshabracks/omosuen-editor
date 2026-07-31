/**
 * CustomTextEditorProvider for .omoscene files.
 * Manages the document model and wires up the scene tree,
 * inspector, and preview sync.
 */
import * as vscode from 'vscode';
import { type OmosceneFile } from '../types/omoscene';
import { type SerializedComponent, type SerializedNexus } from '../types/engine';
import { SceneTreeProvider } from '../panels/scene-tree';
import { InspectorProvider } from '../panels/inspector';
export declare class OmosceneEditorProvider implements vscode.CustomTextEditorProvider {
    private readonly sceneTree;
    private readonly inspector;
    static readonly viewType = "omosuen.omosceneEditor";
    private activeDocument;
    private activeParsed;
    private activePanel;
    private _inAudioEditor;
    private _audioEffectId;
    constructor(sceneTree: SceneTreeProvider, inspector: InspectorProvider);
    /**
     * Get the currently parsed scene data
     */
    getActiveScene(): OmosceneFile | null;
    resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel, _token: vscode.CancellationToken): Promise<void>;
    /**
     * Add a component as a child of the given parent nexus.
     */
    addComponent(parentId: number, component: SerializedComponent): Promise<void>;
    /**
     * Remove a component by ID from the scene.
     */
    removeComponent(componentId: number): Promise<void>;
    /**
     * Returns the next available component ID (max existing + 1).
     */
    getNextId(): number;
    /**
     * Move a component to a new parent at a specific index.
     */
    moveComponent(componentId: number, newParentId: number, index: number): Promise<void>;
    /**
     * Write an updated OmosceneFile back to the active document.
     */
    private writeDocument;
    /**
     * Update a component property in the document
     */
    updateComponentProperty(componentId: number, property: string, value: unknown): Promise<void>;
    /**
     * Update camera state in the editor metadata (persisted to .omoscene on save)
     */
    updateCameraState(panX: number, panY: number, zoom: number): void;
    /**
     * Get the current camera state from editor metadata
     */
    getCameraState(): {
        panX: number;
        panY: number;
        zoom: number;
    } | null;
    /**
     * Notify the editor canvas webview of the currently selected entity
     */
    selectEntity(entityId: number, componentType?: string): void;
    /**
     * Enable or disable cell-map editing mode in the webview
     */
    setCellEditMode(enabled: boolean): void;
    /**
     * Switch the editor webview to the audio editor scene
     */
    enterAudioEditor(effectComponent: SerializedComponent): void;
    /**
     * Switch back from audio editor to the normal editor scene
     */
    exitAudioEditor(): void;
    /**
     * Forward a property update to the audio editor overlay if active
     */
    forwardAudioEditorUpdate(property: string, value: unknown): void;
    /**
     * Collect audio-track file URIs from the scene (follows collectTextureMapUris pattern)
     */
    private collectAudioTrackUris;
    private walkForAudioTracks;
    private postSceneData;
}
export declare function findComponentById(component: SerializedComponent, id: number): SerializedComponent | null;
export declare function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void;
export declare function findParentNexus(root: SerializedComponent, childId: number): SerializedNexus | null;
export declare function getMaxId(component: SerializedComponent): number;
export declare function countComponents(component: SerializedComponent): number;
export declare function escapeHtml(text: string): string;
interface EditorEntity {
    name: string;
    id: number;
    transformId?: number;
    position: {
        x: number;
        y: number;
        z: number;
    };
    rotation: {
        x: number;
        y: number;
        z: number;
    };
    scale: {
        x: number;
        y: number;
        z: number;
    };
    sprite?: {
        albedoKey: string;
        frameIndex: number;
        anchor: {
            x: number;
            y: number;
        };
        tint: {
            x: number;
            y: number;
            z: number;
            w: number;
        };
        opacity: number;
        showSilhouette: boolean;
        silhouetteColor: {
            x: number;
            y: number;
            z: number;
            w: number;
        };
    };
    camera?: {
        id: number;
        name: string;
        zoom: number;
        pixelScale: number;
        axonometricAngle: number;
        viewportWidth: number;
        viewportHeight: number;
    };
    animationController?: {
        id: number;
        animations: Array<{
            name: string;
            frames: number[];
            frameRate: number;
            loop: boolean;
            onComplete?: string;
        }>;
        currentAnimation: string | null;
        state: 'playing' | 'paused' | 'stopped';
        speed: number;
        channels: string[];
    };
}
export declare function extractEntities(scene: SerializedComponent): EditorEntity[];
export {};
