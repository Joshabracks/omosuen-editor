/**
 * .omocomp file format types
 */
import type { SerializedComponent } from './engine';
/**
 * Editor-only metadata stored alongside the component data
 */
export interface OmocompEditorState {
    annotations: {
        notes?: string;
    };
    tags: string[];
}
/**
 * The full .omocomp file structure
 */
export interface OmocompFile {
    $schema?: string;
    omocomp: number;
    engine: string;
    name: string;
    component: SerializedComponent;
    editor: OmocompEditorState;
}
/**
 * Creates a default .omocomp file wrapping a given component
 */
export declare function createOmocomp(name: string, component: SerializedComponent, engineVersion?: string): OmocompFile;
/**
 * Parses a text string as an OmocompFile, returning null on failure
 */
export declare function parseOmocomp(text: string): OmocompFile | null;
