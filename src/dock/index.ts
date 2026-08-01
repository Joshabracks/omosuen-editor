export type {
  DockLayout,
  DockNode,
  DropEdge,
  DropTarget,
  SplitDirection,
  SplitNode,
  TabGroupNode,
  ViewId,
} from './types';
export {
  cloneLayout,
  createSplit,
  createTabGroup,
  equalSizes,
  isSplit,
  isTabGroup,
  normalizeSizes,
} from './types';
export {
  closeTab,
  collectViewIds,
  createIdFactory,
  createPopOutLayout,
  createSingleViewLayout,
  findFirstTabGroup,
  findNode,
  findTabGroupForView,
  insertView,
  moveView,
  setActiveTab,
  setSplitSizes,
} from './mutations';
export { parseLayout, serializeLayout, validateLayout } from './serialize';
export { hitTestDropZone } from './drop';
export { createDefaultLayout } from './default-layout';
export {
  SHELL_DOCK_LAYOUT_KEY,
  SHELL_POPOUTS_KEY,
  SHELL_WORKSPACE_ROOT_KEY,
  readPersistedLayout,
  readPersistedPopOuts,
  readPersistedWorkspaceRoot,
  type PersistedPopOut,
} from './persist';
export {
  DockViewRegistry,
  registerPlaceholderViews,
  type DockViewRegistration,
} from './registry';
export {
  DockController,
  type DockControllerOptions,
  type DockShellHandle,
  type WindowDragBridge,
} from './controller';
export { renderDockNode, viewHostElementId } from './render';
export {
  asPreserved,
  getPreservedById,
  type PreservedHTMLElement,
} from './preserve';
