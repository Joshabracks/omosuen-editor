/**
 * Contribution-driven uniqueness gating for add/duplicate (3b).
 */

import { resolveEditorType, type UniquenessMode } from '../editor-api';
import type { OmosceneFile } from '../omoscene';
import { countTypeInScene, countTypeUnderParent } from './mutation';

export interface AddGateResult {
  readonly ok: boolean;
  readonly reason?: string;
}

export function uniquenessForType(
  type: string,
  engineVersion: string,
): UniquenessMode {
  return resolveEditorType(type, engineVersion)?.uniqueness ?? 'FALSE';
}

/** Whether `type` may be added under `parentId` given contribution uniqueness. */
export function canAddComponentType(
  file: OmosceneFile,
  parentId: number,
  type: string,
): AddGateResult {
  const mode = uniquenessForType(type, file.engine);
  if (mode === 'GLOBAL') {
    if (countTypeInScene(file.scene, type) > 0) {
      return {
        ok: false,
        reason: `Only one "${type}" is allowed in the scene (GLOBAL uniqueness).`,
      };
    }
  }
  if (mode === 'LOCAL') {
    if (countTypeUnderParent(file.scene, parentId, type) > 0) {
      return {
        ok: false,
        reason: `Only one "${type}" is allowed under this nexus (LOCAL uniqueness).`,
      };
    }
  }
  return { ok: true };
}

/** Types available in the add palette under a parent (gated). */
export function listAddableTypes(
  file: OmosceneFile,
  parentId: number,
  allTypes: readonly string[],
): string[] {
  return allTypes.filter((type) => canAddComponentType(file, parentId, type).ok);
}
