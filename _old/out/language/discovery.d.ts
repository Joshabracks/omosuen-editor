/**
 * Workspace scanning — discovers scene names and texture keys
 * across .omoscene, .omocomp, and .ts/.js files.
 */
import * as vscode from 'vscode';
export interface SceneNameEntry {
    name: string;
    uri: vscode.Uri;
    line: number;
    source: 'omoscene' | 'code';
}
export interface TextureKeyEntry {
    key: string;
    uri: vscode.Uri;
    line: number;
    source: 'omoscene' | 'omocomp' | 'code';
}
export declare class WorkspaceDiscovery implements vscode.Disposable {
    private sceneNames;
    private textureKeys;
    private watchers;
    constructor();
    scanAllFiles(): Promise<void>;
    getSceneNames(): SceneNameEntry[];
    getTextureKeys(): TextureKeyEntry[];
    dispose(): void;
    private scanOmosceneFile;
    private scanOmocompFile;
    private scanCodeFile;
    private walkComponentsForTextureKeys;
    private addSceneName;
    private addTextureKey;
    private removeByKey;
    private removeEntriesForUri;
}
