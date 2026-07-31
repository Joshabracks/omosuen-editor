/**
 * .omoscene file format types
 */
import type { SerializedComponent } from './engine';
/**
 * Editor-only metadata stored alongside the runtime scene data
 */
export interface EditorState {
    camera: {
        panX: number;
        panY: number;
        zoom: number;
    };
    selection: number[];
    treeState: Record<string, boolean>;
    annotations: Record<string, {
        color?: string;
        notes?: string;
    }>;
    bookmarks: Array<{
        name: string;
        componentId: number;
    }>;
}
/**
 * The full .omoscene file structure
 */
export interface OmosceneFile {
    $schema?: string;
    omoscene: number;
    engine: string;
    name: string;
    scene: SerializedComponent;
    editor: EditorState;
}
/**
 * Creates a default empty .omoscene file
 */
export declare function createDefaultOmoscene(name: string): OmosceneFile;
/**
 * Parses a text string as an OmosceneFile, returning null on failure
 */
export declare function parseOmoscene(text: string): OmosceneFile | null;
