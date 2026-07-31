/**
 * Pure resolver: scan a scene tree for `audio-track` components and
 * return the editor-relevant fields ({ id, name, filePath }) sorted
 * by name.
 *
 * Used by the audio editor's host to feed the `audio:tracks`
 * protocol message and (in Phase B) for the playback decoder. DOM-
 * free, vscode-free — unit-testable under tsx.
 */

import type { SerializedComponent } from '../../omoscene/index.js';

export interface AudioTrackInfo {
  readonly id: number;
  readonly name: string;
  readonly filePath: string;
}

export function collectAudioTracks(
  scene: SerializedComponent,
): AudioTrackInfo[] {
  const out: AudioTrackInfo[] = [];
  walk(scene, (c) => {
    if (c.type !== 'audio-track') return;
    const id = c.id;
    if (typeof id !== 'number' || !Number.isFinite(id)) return;
    const filePath = readString(c, 'filePath');
    // Empty filePath means the user hasn't picked a file yet — keep
    // the entry visible so the dropdown reflects the scene's
    // structure, but Phase B's playback decoder will skip it.
    const name = readString(c, 'name') || `(track #${String(id)})`;
    out.push({ id, name, filePath });
  });
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function walk(
  root: SerializedComponent,
  visit: (c: SerializedComponent) => void,
): void {
  visit(root);
  const children = Array.isArray(root.components) ? root.components : [];
  for (const child of children) {
    if (typeof child !== 'object' || child === null) continue;
    walk(child as SerializedComponent, visit);
  }
}

function readString(component: SerializedComponent, field: string): string {
  const v = (component as Record<string, unknown>)[field];
  return typeof v === 'string' ? v : '';
}
