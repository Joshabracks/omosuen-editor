/**
 * DiagnosticCollection — reports problems in .omoscene/.omocomp and .ts/.js files.
 */

import * as vscode from 'vscode';
import { parseOmoscene } from '../types/omoscene';
import { parseOmocomp } from '../types/omocomp';
import {
  isSerializedNexus,
  ComponentUnique,
  type SerializedComponent,
  type COMPONENT_TYPE,
} from '../types/engine';
import { ALL_COMPONENT_TYPES } from '../commands/component-crud';
import type { WorkspaceDiscovery } from './discovery';

// ── Uniqueness map (mirrors component-crud.ts) ──────────────────

const COMPONENT_UNIQUENESS: Partial<Record<COMPONENT_TYPE, ComponentUnique>> = {
  'camera': ComponentUnique.LOCAL,
  'audio-player': ComponentUnique.GLOBAL,
  'flag-manager': ComponentUnique.GLOBAL,
  'atlas-manager': ComponentUnique.GLOBAL,
};

const COMPONENT_TYPE_SET = new Set<string>(ALL_COMPONENT_TYPES);

// ── Registration ────────────────────────────────────────────────

export function registerDiagnostics(
  context: vscode.ExtensionContext,
  _discovery: WorkspaceDiscovery
): vscode.DiagnosticCollection {
  const collection = vscode.languages.createDiagnosticCollection('omosuen');

  // Debounce timer for code files
  let codeTimer: ReturnType<typeof setTimeout> | undefined;

  const updateDiagnostics = (document: vscode.TextDocument) => {
    const fileName = document.fileName;

    if (fileName.endsWith('.omoscene')) {
      diagOmoscene(document, collection);
    } else if (fileName.endsWith('.omocomp')) {
      diagOmocomp(document, collection);
    } else if (fileName.endsWith('.ts') || fileName.endsWith('.js')) {
      // Debounce code diagnostics
      if (codeTimer) { clearTimeout(codeTimer); }
      codeTimer = setTimeout(() => diagCode(document, collection), 500);
    }
  };

  // Run on open and change
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(updateDiagnostics),
    vscode.workspace.onDidChangeTextDocument((e) => updateDiagnostics(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)),
  );

  // Run on all currently open documents
  for (const doc of vscode.workspace.textDocuments) {
    updateDiagnostics(doc);
  }

  return collection;
}

// ── .omoscene diagnostics ───────────────────────────────────────

function diagOmoscene(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection
): void {
  const text = document.getText();
  const parsed = parseOmoscene(text);
  if (!parsed) {
    collection.delete(document.uri);
    return;
  }

  const diagnostics: vscode.Diagnostic[] = [];
  checkGlobalUniqueness(parsed.scene, text, document, diagnostics);
  checkLocalUniqueness(parsed.scene, text, document, diagnostics);
  checkViewportRef(parsed.scene, text, document, diagnostics);

  collection.set(document.uri, diagnostics);
}

// ── .omocomp diagnostics ───────────────────────────────────────

function diagOmocomp(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection
): void {
  const text = document.getText();
  const parsed = parseOmocomp(text);
  if (!parsed) {
    collection.delete(document.uri);
    return;
  }

  const diagnostics: vscode.Diagnostic[] = [];

  // Only check uniqueness if the component is a nexus with children
  if (isSerializedNexus(parsed.component)) {
    checkGlobalUniqueness(parsed.component, text, document, diagnostics);
    checkLocalUniqueness(parsed.component, text, document, diagnostics);
  }

  collection.set(document.uri, diagnostics);
}

// ── Code file diagnostics ───────────────────────────────────────

function diagCode(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection
): void {
  const text = document.getText();
  const diagnostics: vscode.Diagnostic[] = [];

  // Check component types in newComponent() calls
  const ncRegex = /\bnewComponent\s*\(\s*(['"])([^'"]+)\1/g;
  let m;
  while ((m = ncRegex.exec(text)) !== null) {
    if (!COMPONENT_TYPE_SET.has(m[2])) {
      const pos = document.positionAt(m.index + m[0].indexOf(m[2]));
      const range = new vscode.Range(pos, pos.translate(0, m[2].length));
      diagnostics.push(
        new vscode.Diagnostic(
          range,
          `Unknown component type '${m[2]}'.`,
          vscode.DiagnosticSeverity.Error
        )
      );
    }
  }

  // Check component types in nexus methods
  const methodRegex = /\.(?:getComponentByType|getComponentsByType|getComponentByTypeAndName)\s*\(\s*(['"])([^'"]+)\1/g;
  while ((m = methodRegex.exec(text)) !== null) {
    if (!COMPONENT_TYPE_SET.has(m[2])) {
      const pos = document.positionAt(m.index + m[0].indexOf(m[2]));
      const range = new vscode.Range(pos, pos.translate(0, m[2].length));
      diagnostics.push(
        new vscode.Diagnostic(
          range,
          `Unknown component type '${m[2]}'.`,
          vscode.DiagnosticSeverity.Error
        )
      );
    }
  }

  collection.set(document.uri, diagnostics);
}

// ── Scene checks ────────────────────────────────────────────────

function checkGlobalUniqueness(
  root: SerializedComponent,
  text: string,
  document: vscode.TextDocument,
  diagnostics: vscode.Diagnostic[]
): void {
  const seen = new Map<string, SerializedComponent>();

  walkComponents(root, (component) => {
    const uniqueness = COMPONENT_UNIQUENESS[component.type];
    if (uniqueness !== ComponentUnique.GLOBAL) { return; }

    if (seen.has(component.type)) {
      // Duplicate — report at the position of this component
      const range = findComponentRange(component, text, document);
      diagnostics.push(
        new vscode.Diagnostic(
          range,
          `Duplicate global component: only one '${component.type}' is allowed per scene.`,
          vscode.DiagnosticSeverity.Error
        )
      );
    } else {
      seen.set(component.type, component);
    }
  });
}

function checkLocalUniqueness(
  root: SerializedComponent,
  text: string,
  document: vscode.TextDocument,
  diagnostics: vscode.Diagnostic[]
): void {
  walkComponents(root, (component) => {
    if (!isSerializedNexus(component)) { return; }

    const localSeen = new Map<string, boolean>();
    for (const child of component.components) {
      const uniqueness = COMPONENT_UNIQUENESS[child.type];
      if (uniqueness !== ComponentUnique.LOCAL) { continue; }

      if (localSeen.has(child.type)) {
        const range = findComponentRange(child, text, document);
        diagnostics.push(
          new vscode.Diagnostic(
            range,
            `Duplicate local component: only one '${child.type}' is allowed per nexus.`,
            vscode.DiagnosticSeverity.Error
          )
        );
      } else {
        localSeen.set(child.type, true);
      }
    }
  });
}

function checkViewportRef(
  root: SerializedComponent,
  text: string,
  document: vscode.TextDocument,
  diagnostics: vscode.Diagnostic[]
): void {
  // Collect all viewport names
  const viewportNames = new Set<string>();
  walkComponents(root, (component) => {
    if (component.type === 'viewport' && component.name) {
      viewportNames.add(component.name);
    }
  });

  // Check camera viewportRef values
  walkComponents(root, (component) => {
    if (component.type !== 'camera') { return; }
    const ref = component.viewportRef as string | undefined;
    if (!ref) { return; }

    if (!viewportNames.has(ref)) {
      const range = findComponentRange(component, text, document);
      diagnostics.push(
        new vscode.Diagnostic(
          range,
          `viewportRef '${ref}' does not match any viewport component name in this scene.`,
          vscode.DiagnosticSeverity.Warning
        )
      );
    }
  });
}

// ── Helpers ─────────────────────────────────────────────────────

function walkComponents(
  component: SerializedComponent,
  visitor: (c: SerializedComponent) => void
): void {
  visitor(component);
  if (isSerializedNexus(component)) {
    for (const child of component.components) {
      walkComponents(child, visitor);
    }
  }
}

function findComponentRange(
  component: SerializedComponent,
  text: string,
  document: vscode.TextDocument
): vscode.Range {
  // Try to find the component by its ID in the JSON
  if (component.id !== undefined) {
    const idPattern = `"id": ${component.id}`;
    const idx = text.indexOf(idPattern);
    if (idx >= 0) {
      const pos = document.positionAt(idx);
      return new vscode.Range(pos, pos.translate(0, idPattern.length));
    }
  }

  // Fallback: search for the name
  if (component.name) {
    const namePattern = `"name": "${component.name}"`;
    const idx = text.indexOf(namePattern);
    if (idx >= 0) {
      const pos = document.positionAt(idx);
      return new vscode.Range(pos, pos.translate(0, namePattern.length));
    }
  }

  // Last resort: first line
  return new vscode.Range(0, 0, 0, 0);
}
