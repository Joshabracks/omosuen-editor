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
export function createOmocomp(
  name: string,
  component: SerializedComponent,
  engineVersion?: string
): OmocompFile {
  return {
    omocomp: 1,
    engine: engineVersion ?? '0.1.0',
    name,
    component: JSON.parse(JSON.stringify(component)) as SerializedComponent,
    editor: {
      annotations: {},
      tags: [],
    },
  };
}

/**
 * Parses a text string as an OmocompFile, returning null on failure
 */
export function parseOmocomp(text: string): OmocompFile | null {
  try {
    const data = JSON.parse(text) as OmocompFile;
    if (typeof data.omocomp !== 'number' || !data.component) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}
