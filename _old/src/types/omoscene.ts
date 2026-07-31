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
  annotations: Record<
    string,
    {
      color?: string;
      notes?: string;
    }
  >;
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
export function createDefaultOmoscene(name: string): OmosceneFile {
  return {
    omoscene: 1,
    engine: '0.1.0',
    name,
    scene: {
      type: 'nexus',
      name: `${name}Root`,
      id: 0,
      unique: 0,
      components: [],
    },
    editor: {
      camera: { panX: 0, panY: 0, zoom: 1.0 },
      selection: [],
      treeState: {},
      annotations: {},
      bookmarks: [],
    },
  };
}

/**
 * Parses a text string as an OmosceneFile, returning null on failure
 */
export function parseOmoscene(text: string): OmosceneFile | null {
  try {
    const data = JSON.parse(text) as OmosceneFile;
    if (typeof data.omoscene !== 'number' || !data.scene) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}
