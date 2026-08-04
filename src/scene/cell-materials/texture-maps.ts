/**
 * Collect scene texture-maps for cell-materials channel dropdowns (6a).
 */

import type { SerializedComponent } from '../../omoscene';
import {
  deriveFrameRects,
  parseImageType,
  type FrameRect,
  type ImageDims,
  type Mode,
} from '../texture-frame/image-type';

export interface SceneTextureMapRef {
  readonly key: string;
  readonly filePath: string;
  readonly mode: Mode;
  readonly frames: readonly FrameRect[];
}

/** Walk the scene tree and collect unique texture-map keys (first wins). */
export function collectSceneTextureMaps(
  scene: SerializedComponent,
  imageDimsByKey?: ReadonlyMap<string, ImageDims>,
): SceneTextureMapRef[] {
  const out: SceneTextureMapRef[] = [];
  const seen = new Set<string>();
  walk(scene, (node) => {
    if (node.type !== 'texture-map') return;
    const key = readString(node, 'textureMapKey');
    if (!key || seen.has(key)) return;
    seen.add(key);
    const imageType = parseImageType(
      (node as Record<string, unknown>)['imageType'],
    );
    const dims = imageDimsByKey?.get(key);
    out.push({
      key,
      filePath: readString(node, 'filePath'),
      mode: imageType.mode,
      frames: deriveFrameRects(imageType, dims),
    });
  });
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

function walk(
  node: SerializedComponent,
  visit: (n: SerializedComponent) => void,
): void {
  visit(node);
  const children = Array.isArray(node.components) ? node.components : [];
  for (const child of children) {
    if (typeof child === 'object' && child !== null) {
      walk(child as SerializedComponent, visit);
    }
  }
}

function readString(component: SerializedComponent, field: string): string {
  const v = (component as Record<string, unknown>)[field];
  return typeof v === 'string' ? v : '';
}
