/**
 * Pure reducer for cell-map `materials[]` (6a).
 *
 * Four texture channels (albedo / normal / emission / material), each with
 * a texture-map key and a frame index.
 */

export type MaterialChannel =
  | 'albedo'
  | 'normal'
  | 'emission'
  | 'material';

export const MATERIAL_CHANNELS: readonly MaterialChannel[] = [
  'albedo',
  'normal',
  'emission',
  'material',
];

export interface CellMapMaterial {
  readonly albedoTextureKey: string;
  readonly normalTextureKey: string;
  readonly emissionTextureKey: string;
  readonly materialTextureKey: string;
  readonly albedoFrame: number;
  readonly normalFrame: number;
  readonly emissionFrame: number;
  readonly materialFrame: number;
}

export function emptyMaterial(): CellMapMaterial {
  return {
    albedoTextureKey: '',
    normalTextureKey: '',
    emissionTextureKey: '',
    materialTextureKey: '',
    albedoFrame: 0,
    normalFrame: 0,
    emissionFrame: 0,
    materialFrame: 0,
  };
}

export function channelTextureKey(
  channel: MaterialChannel,
): keyof CellMapMaterial {
  return `${channel}TextureKey` as keyof CellMapMaterial;
}

export function channelFrameKey(
  channel: MaterialChannel,
): keyof CellMapMaterial {
  return `${channel}Frame` as keyof CellMapMaterial;
}

/** Normalize unknown serialized materials into `CellMapMaterial[]`. */
export function parseMaterials(raw: unknown): CellMapMaterial[] {
  if (!Array.isArray(raw)) return [];
  const out: CellMapMaterial[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    out.push({
      albedoTextureKey: readString(rec, 'albedoTextureKey'),
      normalTextureKey: readString(rec, 'normalTextureKey'),
      emissionTextureKey: readString(rec, 'emissionTextureKey'),
      materialTextureKey: readString(rec, 'materialTextureKey'),
      albedoFrame: readFrame(rec, 'albedoFrame'),
      normalFrame: readFrame(rec, 'normalFrame'),
      emissionFrame: readFrame(rec, 'emissionFrame'),
      materialFrame: readFrame(rec, 'materialFrame'),
    });
  }
  return out;
}

export function serializeMaterials(
  materials: readonly CellMapMaterial[],
): Record<string, unknown>[] {
  return materials.map((m) => ({
    albedoTextureKey: m.albedoTextureKey,
    normalTextureKey: m.normalTextureKey,
    emissionTextureKey: m.emissionTextureKey,
    materialTextureKey: m.materialTextureKey,
    albedoFrame: m.albedoFrame,
    normalFrame: m.normalFrame,
    emissionFrame: m.emissionFrame,
    materialFrame: m.materialFrame,
  }));
}

export function addMaterial(
  materials: readonly CellMapMaterial[],
): CellMapMaterial[] {
  return [...materials, emptyMaterial()];
}

export function removeMaterialAt(
  materials: readonly CellMapMaterial[],
  index: number,
): CellMapMaterial[] {
  if (index < 0 || index >= materials.length) return [...materials];
  return [
    ...materials.slice(0, index),
    ...materials.slice(index + 1),
  ];
}

export function setChannelTextureKey(
  materials: readonly CellMapMaterial[],
  index: number,
  channel: MaterialChannel,
  textureKey: string,
): CellMapMaterial[] {
  if (index < 0 || index >= materials.length) return [...materials];
  return materials.map((m, i) => {
    if (i !== index) return m;
    return {
      ...m,
      [channelTextureKey(channel)]: textureKey,
      // Reset frame when the texture changes (matches V1 behavior).
      [channelFrameKey(channel)]: 0,
    };
  });
}

export function setChannelFrame(
  materials: readonly CellMapMaterial[],
  index: number,
  channel: MaterialChannel,
  frame: number,
): CellMapMaterial[] {
  if (index < 0 || index >= materials.length) return [...materials];
  if (!Number.isFinite(frame) || frame < 0) return [...materials];
  const next = Math.floor(frame);
  return materials.map((m, i) => {
    if (i !== index) return m;
    return { ...m, [channelFrameKey(channel)]: next };
  });
}

function readString(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  return typeof v === 'string' ? v : '';
}

function readFrame(rec: Record<string, unknown>, key: string): number {
  const v = rec[key];
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.floor(v);
  return 0;
}
