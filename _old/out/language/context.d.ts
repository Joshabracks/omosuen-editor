/**
 * Cursor context detection — shared utility for language providers.
 * Uses regex heuristics to determine what engine API call the cursor is inside.
 */
import * as vscode from 'vscode';
import type { COMPONENT_TYPE } from '../types/engine';
export type CursorContext = {
    kind: 'newComponent-type';
    prefix: string;
} | {
    kind: 'newComponent-options';
    componentType: COMPONENT_TYPE;
    property: string | null;
    prefix: string;
} | {
    kind: 'scene-name';
    prefix: string;
} | {
    kind: 'component-type-arg';
    prefix: string;
} | {
    kind: 'texture-key';
    prefix: string;
} | {
    kind: 'none';
};
/**
 * Detect the cursor context based on the text before the cursor.
 */
export declare function detectCursorContext(document: vscode.TextDocument, position: vscode.Position): CursorContext;
/**
 * Extract the full string literal at the cursor position.
 */
export declare function extractStringLiteralRange(document: vscode.TextDocument, position: vscode.Position): {
    value: string;
    range: vscode.Range;
} | null;
