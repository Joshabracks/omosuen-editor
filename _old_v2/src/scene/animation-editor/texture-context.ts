/**
 * Pure resolver: animation-controller → sibling sprite → texture-map → frames.
 *
 * The animation editor needs to render real frame thumbnails (palette,
 * timeline, preview) drawn from the source image. That means walking
 * the scene tree to find the data that defines what "frame N" means
 * in pixel space:
 *
 *   1. Animation-controller's parent nexus.
 *   2. A sibling sprite component within that nexus.
 *   3. The sprite's `textureMapKeys.albedo` — the channel `_old` used
 *      for editor thumbnails. (`_old` line 108.)
 *   4. A `texture-map` anywhere in the scene whose `textureMapKey`
 *      matches that albedo key.
 *   5. The texture-map's `filePath` (host needs this for image-loading)
 *      and parsed `imageType` (frame rectangles).
 *
 * DOM-free, vscode-free. The host uses this to know which file to read
 * for `image:loaded`; the webview uses it to compute frame rects from
 * `imageType` so it can clip the source image into per-frame thumbnails.
 */

import type { SerializedComponent } from '../../omoscene/index.js';
import {
  deriveFrameRects,
  parseImageType,
  type FrameRect,
  type ImageDims,
  type Mode,
} from '../../state/image-type.js';

export interface TextureContext {
  /** Sibling sprite's name; for display in the editor header. */
  readonly spriteName: string | null;
  /** The `textureMapKey` referenced by sprite.textureMapKeys.albedo. */
  readonly textureMapKey: string;
  /** Scene-relative path to the source image; passed to the host. */
  readonly filePath: string;
  /** Parsed imageType mode (single / grid / framemap). */
  readonly mode: Mode;
  /**
   * Frame rectangles defined by the texture-map's `imageType`. For
   * Single mode this is empty unless `imageDims` was provided; the
   * caller (webview) supplies it after the image loads so the
   * full-image rect can be synthesized.
   */
  readonly frames: readonly FrameRect[];
}

/**
 * Resolve the chain. Returns `null` if any link is broken — animation-
 * controller has no parent, no sibling sprite, sprite has no albedo,
 * no matching texture-map, etc. The animation editor renders a
 * "no sprite texture found" placeholder when this returns null.
 */
export function resolveTextureContext(
  scene: SerializedComponent,
  animationControllerId: number,
  imageDims?: ImageDims,
): TextureContext | null {
  const parent = findParentNexus(scene, animationControllerId);
  if (parent === null) return null;
  const sprite = findSiblingSprite(parent);
  if (sprite === null) return null;
  const albedoKey = readAlbedoKey(sprite);
  if (albedoKey === '') return null;
  const textureMap = findTextureMapByKey(scene, albedoKey);
  if (textureMap === null) return null;
  const filePath = readString(textureMap, 'filePath');
  const editorState = parseImageType(
    (textureMap as Record<string, unknown>)['imageType'],
  );
  return {
    spriteName: readString(sprite, 'name') || null,
    textureMapKey: albedoKey,
    filePath,
    mode: editorState.mode,
    frames: deriveFrameRects(editorState, imageDims),
  };
}

function findParentNexus(
  root: SerializedComponent,
  childId: number,
): SerializedComponent | null {
  const children = Array.isArray(root.components) ? root.components : [];
  for (const child of children) {
    if (!isNode(child)) continue;
    if (child.id === childId) return root;
    const hit = findParentNexus(child, childId);
    if (hit !== null) return hit;
  }
  return null;
}

function findSiblingSprite(
  parent: SerializedComponent,
): SerializedComponent | null {
  const children = Array.isArray(parent.components) ? parent.components : [];
  for (const child of children) {
    if (!isNode(child)) continue;
    if (child.type === 'sprite') return child;
  }
  return null;
}

function readAlbedoKey(sprite: SerializedComponent): string {
  const tmKeys = (sprite as Record<string, unknown>)['textureMapKeys'];
  if (typeof tmKeys !== 'object' || tmKeys === null) return '';
  const albedo = (tmKeys as Record<string, unknown>)['albedo'];
  return typeof albedo === 'string' ? albedo : '';
}

function findTextureMapByKey(
  root: SerializedComponent,
  key: string,
): SerializedComponent | null {
  if (
    root.type === 'texture-map' &&
    readString(root, 'textureMapKey') === key
  ) {
    return root;
  }
  const children = Array.isArray(root.components) ? root.components : [];
  for (const child of children) {
    if (!isNode(child)) continue;
    const hit = findTextureMapByKey(child, key);
    if (hit !== null) return hit;
  }
  return null;
}

function readString(component: SerializedComponent, field: string): string {
  const v = (component as Record<string, unknown>)[field];
  return typeof v === 'string' ? v : '';
}

function isNode(value: unknown): value is SerializedComponent {
  return typeof value === 'object' && value !== null;
}
