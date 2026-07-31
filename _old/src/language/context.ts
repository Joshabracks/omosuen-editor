/**
 * Cursor context detection — shared utility for language providers.
 * Uses regex heuristics to determine what engine API call the cursor is inside.
 */

import * as vscode from 'vscode';
import type { COMPONENT_TYPE } from '../types/engine';
import { ALL_COMPONENT_TYPES } from '../commands/component-crud';

// ── Context Types ───────────────────────────────────────────────

export type CursorContext =
  | { kind: 'newComponent-type'; prefix: string }
  | { kind: 'newComponent-options'; componentType: COMPONENT_TYPE; property: string | null; prefix: string }
  | { kind: 'scene-name'; prefix: string }
  | { kind: 'component-type-arg'; prefix: string }
  | { kind: 'texture-key'; prefix: string }
  | { kind: 'none' };

const COMPONENT_TYPE_SET = new Set<string>(ALL_COMPONENT_TYPES);

// ── Main Detector ───────────────────────────────────────────────

/**
 * Detect the cursor context based on the text before the cursor.
 */
export function detectCursorContext(
  document: vscode.TextDocument,
  position: vscode.Position
): CursorContext {
  // Gather text from the start of the document (or a window) to the cursor
  const startLine = Math.max(0, position.line - 50);
  const textBefore = document.getText(
    new vscode.Range(startLine, 0, position.line, position.character)
  );

  // 1. newComponent type argument: newComponent('|
  const ncTypeMatch = textBefore.match(
    /\bnewComponent\s*\(\s*(['"])([^'"]*?)$/
  );
  if (ncTypeMatch) {
    return { kind: 'newComponent-type', prefix: ncTypeMatch[2] };
  }

  // 2. newComponent options: newComponent('type', { ... |
  const ncOptionsCtx = detectNewComponentOptions(textBefore);
  if (ncOptionsCtx) {
    return ncOptionsCtx;
  }

  // 3. Scene name functions: switchScene('|, loadScene('|, etc.
  const sceneMatch = textBefore.match(
    /\b(?:switchScene|loadScene|registerScene|registerSceneModule|registerSceneSerialized|hasScene)\s*\(\s*(['"])([^'"]*?)$/
  );
  if (sceneMatch) {
    return { kind: 'scene-name', prefix: sceneMatch[2] };
  }

  // 4. Component type in nexus methods: getComponentByType('|
  const compTypeArgMatch = textBefore.match(
    /\.(?:getComponentByType|getComponentsByType|getComponentByTypeAndName|getComponentsByTypeAndName)\s*\(\s*(['"])([^'"]*?)$/
  );
  if (compTypeArgMatch) {
    return { kind: 'component-type-arg', prefix: compTypeArgMatch[2] };
  }

  // 5. Texture key: textureMapKey: '| or textureMapKeys: { albedo: '|
  const texKeyMatch = textBefore.match(
    /\btextureMapKey(?:s\s*:\s*\{[^}]*(?:albedo|normal|material|emission)\s*:\s*)?\s*:\s*(['"])([^'"]*?)$/
  );
  if (texKeyMatch) {
    return { kind: 'texture-key', prefix: texKeyMatch[2] };
  }

  return { kind: 'none' };
}

// ── Options Detection ───────────────────────────────────────────

/**
 * Detect if the cursor is inside the options object of a newComponent call.
 * Returns the component type and whether the cursor is at a key or value position.
 */
function detectNewComponentOptions(textBefore: string): CursorContext | null {
  // Find the last newComponent('type', { pattern
  const match = textBefore.match(
    /\bnewComponent\s*\(\s*['"]([^'"]+)['"]\s*,\s*\{([\s\S]*)$/
  );
  if (!match) { return null; }

  const typeStr = match[1];
  if (!COMPONENT_TYPE_SET.has(typeStr)) { return null; }

  const componentType = typeStr as COMPONENT_TYPE;
  const insideBraces = match[2];

  // Check brace balance — make sure we're still inside the { }
  let depth = 1;
  for (const ch of insideBraces) {
    if (ch === '{') { depth++; }
    else if (ch === '}') { depth--; }
    if (depth === 0) { return null; } // cursor is after the closing brace
  }

  // Determine if cursor is at a key position or value position
  // Look at what comes after the last comma or opening brace (at depth 1)
  const afterLastSep = getTextAfterLastSeparator(insideBraces);
  const trimmed = afterLastSep.trimStart();

  // Value position: "propertyName: |" or "propertyName: '|"
  const valueMatch = trimmed.match(/^(\w+)\s*:\s*(['"]?)([^'"]*?)$/);
  if (valueMatch) {
    return {
      kind: 'newComponent-options',
      componentType,
      property: valueMatch[1],
      prefix: valueMatch[3],
    };
  }

  // Key position: after { or , with optional partial key typed
  const keyMatch = trimmed.match(/^(\w*)$/);
  if (keyMatch) {
    return {
      kind: 'newComponent-options',
      componentType,
      property: null,
      prefix: keyMatch[1],
    };
  }

  return null;
}

/**
 * Get the text after the last top-level comma or opening brace.
 */
function getTextAfterLastSeparator(text: string): string {
  let depth = 0;
  let lastSep = -1;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (ch === stringChar && text[i - 1] !== '\\') {
        inString = false;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === '{' || ch === '[') { depth++; }
    else if (ch === '}' || ch === ']') { depth--; }
    else if (ch === ',' && depth === 0) { lastSep = i; }
  }

  return text.slice(lastSep + 1);
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Extract the full string literal at the cursor position.
 */
export function extractStringLiteralRange(
  document: vscode.TextDocument,
  position: vscode.Position
): { value: string; range: vscode.Range } | null {
  const line = document.lineAt(position.line).text;
  const col = position.character;

  // Search backwards for opening quote
  let start = -1;
  let quoteChar = '';
  for (let i = col - 1; i >= 0; i--) {
    if (line[i] === "'" || line[i] === '"') {
      start = i;
      quoteChar = line[i];
      break;
    }
  }
  if (start === -1) { return null; }

  // Search forwards for closing quote
  let end = -1;
  for (let i = col; i < line.length; i++) {
    if (line[i] === quoteChar) {
      end = i;
      break;
    }
  }
  if (end === -1) { return null; }

  const value = line.slice(start + 1, end);
  const range = new vscode.Range(
    position.line, start + 1,
    position.line, end
  );

  return { value, range };
}
