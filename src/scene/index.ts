/**
 * Scene document helpers (3b).
 */

export {
  applyComponentUpdate,
  countTypeInScene,
  countTypeUnderParent,
  duplicateComponent,
  findComponentById,
  findParentId,
  insertChildComponent,
  moveComponent,
  nextComponentId,
  reassignIds,
  removeComponent,
  reparentComponent,
  setNestedMutating,
  walkSceneTree,
  type MoveDirection,
} from './mutation';
export { buildDefaultComponent } from './defaults';
export {
  canAddComponentType,
  listAddableTypes,
  uniquenessForType,
  type AddGateResult,
} from './uniqueness';
