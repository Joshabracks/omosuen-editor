import type {
  EditorRegistryContribution,
  EditorToolContribution,
  EditorTypeContribution,
  EditorTypeEntry,
  ResolvedEditorType,
} from './types';
import {
  compareVersions,
  resolveEditorTypeVersion,
  toResolved,
} from './version';

const typeRegistry = new Map<string, EditorTypeContribution[]>();
const toolRegistry = new Map<string, EditorToolContribution>();
const keyRegistry = new Map<string, EditorRegistryContribution>();

export class EditorApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditorApiError';
  }
}

function validateContribution(entry: EditorTypeContribution): void {
  if (!entry.type.trim()) {
    throw new EditorApiError('registerEditorType requires non-empty type');
  }
  if (!entry.since.trim()) {
    throw new EditorApiError(
      `registerEditorType(${entry.type}): since is required`,
    );
  }
  if (!Array.isArray(entry.fields)) {
    throw new EditorApiError(
      `registerEditorType(${entry.type}): fields must be an array`,
    );
  }
  const seen = new Set<string>();
  for (const field of entry.fields) {
    if (!field.name || typeof field.name !== 'string') {
      throw new EditorApiError(
        `registerEditorType(${entry.type}@${entry.since}): field missing name`,
      );
    }
    if (seen.has(field.name)) {
      throw new EditorApiError(
        `registerEditorType(${entry.type}@${entry.since}): duplicate field "${field.name}"`,
      );
    }
    seen.add(field.name);
  }
}

/**
 * Register one versioned editor type contribution (E16).
 * Multiple calls for the same `type` with different `since` accumulate.
 * Duplicate `type` + `since` is rejected.
 */
export function registerEditorType(entry: EditorTypeContribution): void {
  validateContribution(entry);
  const existing = typeRegistry.get(entry.type) ?? [];
  for (const prev of existing) {
    if (compareVersions(prev.since, entry.since) === 0) {
      throw new EditorApiError(
        `registerEditorType: duplicate type+since "${entry.type}" @ ${entry.since}`,
      );
    }
  }
  const next = [...existing, entry].sort((a, b) =>
    compareVersions(a.since, b.since),
  );
  typeRegistry.set(entry.type, next);
}

export function registerEditorTool(entry: EditorToolContribution): void {
  if (!entry.id.trim()) {
    throw new EditorApiError('registerEditorTool requires non-empty id');
  }
  if (typeof entry.open !== 'function') {
    throw new EditorApiError(
      `registerEditorTool(${entry.id}): open must be a function`,
    );
  }
  if (toolRegistry.has(entry.id)) {
    throw new EditorApiError(
      `registerEditorTool: duplicate id "${entry.id}"`,
    );
  }
  toolRegistry.set(entry.id, entry);
}

export function registerEditorRegistry(
  entry: EditorRegistryContribution,
): void {
  if (!entry.id.trim()) {
    throw new EditorApiError('registerEditorRegistry requires non-empty id');
  }
  if (typeof entry.listKeys !== 'function') {
    throw new EditorApiError(
      `registerEditorRegistry(${entry.id}): listKeys must be a function`,
    );
  }
  if (keyRegistry.has(entry.id)) {
    throw new EditorApiError(
      `registerEditorRegistry: duplicate id "${entry.id}"`,
    );
  }
  keyRegistry.set(entry.id, entry);
}

export function getEditorTypeEntry(type: string): EditorTypeEntry | null {
  const versions = typeRegistry.get(type);
  if (!versions || versions.length === 0) return null;
  return { type, versions };
}

export function resolveEditorType(
  type: string,
  engineVersion: string,
): ResolvedEditorType | null {
  const entry = getEditorTypeEntry(type);
  if (!entry) return null;
  const matched = resolveEditorTypeVersion(entry.versions, engineVersion);
  return matched ? toResolved(matched) : null;
}

/** Palette / tree: all registered component type ids, sorted. */
export function listEditorTypes(): string[] {
  return Array.from(typeRegistry.keys()).sort();
}

export function listEditorTools(): string[] {
  return Array.from(toolRegistry.keys()).sort();
}

export function getEditorTool(id: string): EditorToolContribution | null {
  return toolRegistry.get(id) ?? null;
}

export function listEditorRegistries(): string[] {
  return Array.from(keyRegistry.keys()).sort();
}

export function getEditorRegistry(
  id: string,
): EditorRegistryContribution | null {
  return keyRegistry.get(id) ?? null;
}

/** Test helper — clear all contribution maps. */
export function resetEditorApiForTests(): void {
  typeRegistry.clear();
  toolRegistry.clear();
  keyRegistry.clear();
}
