/**
 * Starter / demo scene layout for New Scene and scaffolding.
 *
 * Root children (in order):
 *   Main Viewport, Ambient Light, Atlas Manager, Camera Nexus
 *     └── Main Camera, Camera Transform
 */

import {
  createEmptyOmosceneFile,
  withEditorMetadata,
  type OmosceneFile,
} from '../omoscene';
import { buildDefaultComponent } from './defaults';
import { insertChildComponent } from './mutation';

export interface StarterSceneOptions {
  readonly name: string;
  readonly engine: string;
}

/** Build a playable authoring starter scene (ids assigned stably). */
export function createStarterScene(options: StarterSceneOptions): OmosceneFile {
  const { name, engine } = options;
  const base = createEmptyOmosceneFile({ name, engine });

  let file = insertChildComponent(base, 0, {
    type: 'viewport',
    name: 'Main Viewport',
    id: 1,
    unique: 0,
    width: 800,
    height: 600,
    offsetX: 0,
    offsetY: 0,
    backgroundColor: { x: 0.08, y: 0.09, z: 0.12, w: 1 },
  });

  file = insertChildComponent(file, 0, {
    type: 'light',
    name: 'Ambient Light',
    id: 2,
    unique: 0,
    lightType: 'ambient',
    color: { x: 1, y: 1, z: 1 },
    brightness: 1,
    radius: 100,
    hardness: 0,
    direction: { x: 0, y: -1, z: 0 },
  });

  file = insertChildComponent(
    file,
    0,
    buildDefaultComponent({
      type: 'atlas-manager',
      id: 3,
      engineVersion: engine,
      name: 'Atlas Manager',
    }),
  );

  file = insertChildComponent(file, 0, {
    type: 'nexus',
    name: 'Camera Nexus',
    id: 4,
    unique: 0,
    components: [],
  });

  file = insertChildComponent(file, 4, {
    type: 'camera',
    name: 'Main Camera',
    id: 5,
    unique: 0,
    zoom: 1,
    pixelScale: 2,
    axonometricAngle: 30,
    viewportRef: 'Main Viewport',
  });

  const transform = buildDefaultComponent({
    type: 'transform',
    id: 6,
    engineVersion: engine,
    name: 'Camera Transform',
  });
  (transform as Record<string, unknown>).scale = {
    _vectorType: 'Vector3D',
    x: 1,
    y: 1,
    z: 1,
  };
  file = insertChildComponent(file, 4, transform);

  return withEditorMetadata(file, {
    ...file.editor,
    treeState: { '4': true },
    selection: [5],
  });
}

/** Ensure a user-entered name becomes a `.omoscene` filename. */
export function ensureOmosceneFileName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return 'Main.omoscene';
  return /\.omoscene$/i.test(trimmed) ? trimmed : `${trimmed}.omoscene`;
}

/** Scene display name from a `.omoscene` filename (no path). */
export function sceneNameFromFileName(fileName: string): string {
  return fileName.replace(/\.omoscene$/i, '') || 'Main';
}

/**
 * Parent directory for a new file created from an explorer row.
 * Directories → that path; files → dirname; empty → workspace root.
 */
export function createTargetDir(
  relativePath: string,
  kind: 'file' | 'directory',
): string {
  const norm = relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (kind === 'directory') return norm;
  const idx = norm.lastIndexOf('/');
  return idx < 0 ? '' : norm.slice(0, idx);
}

/** Join a workspace-relative directory with a file name. */
export function joinRelative(dir: string, fileName: string): string {
  const d = dir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const f = fileName.replace(/\\/g, '/').replace(/^\/+/, '');
  return d === '' ? f : `${d}/${f}`;
}
