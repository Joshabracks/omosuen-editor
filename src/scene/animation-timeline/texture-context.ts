/**
 * Resolve texture for animation-timeline thumbnails / preview (5b).
 *
 * Controller path: parent nexus → sibling sprite → albedo key → texture-map.
 * Animation-map fallback: texture-map whose textureMapKey === animationMapKey.
 */

import type { SerializedComponent } from '../../omoscene';
import {
  deriveFrameRects,
  parseImageType,
  type FrameRect,
  type ImageDims,
  type Mode,
} from '../texture-frame/image-type';

export interface TextureContext {
  readonly spriteName: string | null;
  readonly textureMapKey: string;
  readonly filePath: string;
  readonly mode: Mode;
  readonly frames: readonly FrameRect[];
}

export function resolveTextureContext(
  scene: SerializedComponent,
  componentId: number,
  imageDims?: ImageDims,
): TextureContext | null {
  const parent = findParentNexus(scene, componentId);
  if (parent !== null) {
    const sprite = findSiblingSprite(parent);
    if (sprite !== null) {
      const albedoKey = readAlbedoKey(sprite);
      if (albedoKey !== '') {
        const textureMap = findTextureMapByKey(scene, albedoKey);
        if (textureMap !== null) {
          return buildContext(textureMap, readString(sprite, 'name') || null, albedoKey, imageDims);
        }
      }
    }
  }

  const target = findById(scene, componentId);
  if (target !== null && target.type === 'animation-map') {
    const key = readString(target, 'animationMapKey');
    if (key !== '') {
      const textureMap = findTextureMapByKey(scene, key);
      if (textureMap !== null) {
        return buildContext(textureMap, null, key, imageDims);
      }
    }
  }

  return null;
}

function buildContext(
  textureMap: SerializedComponent,
  spriteName: string | null,
  textureMapKey: string,
  imageDims?: ImageDims,
): TextureContext {
  const editorState = parseImageType(
    (textureMap as Record<string, unknown>)['imageType'],
  );
  return {
    spriteName,
    textureMapKey,
    filePath: readString(textureMap, 'filePath'),
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

function findById(
  root: SerializedComponent,
  id: number,
): SerializedComponent | null {
  if (root.id === id) return root;
  const children = Array.isArray(root.components) ? root.components : [];
  for (const child of children) {
    if (!isNode(child)) continue;
    const hit = findById(child, id);
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
