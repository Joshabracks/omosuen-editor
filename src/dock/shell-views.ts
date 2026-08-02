import {
  FILE_EXPLORER_VIEW_ID,
  mountFileExplorer,
  type FileExplorerDeps,
} from '../views/file-explorer';
import {
  INSPECTOR_VIEW_ID,
  mountInspector,
  type InspectorHostDeps,
} from '../views/inspector';
import { mountOutput, OUTPUT_VIEW_ID } from '../views/output';
import {
  mountProblems,
  PROBLEMS_VIEW_ID,
  type ProblemsDeps,
} from '../views/problems';
import {
  mountSceneTree,
  SCENE_TREE_VIEW_ID,
  type SceneTreeDeps,
} from '../views/scene-tree';
import {
  mountTextBuffer,
  TEXT_BUFFER_VIEW_ID,
  type EditorsDeps,
} from '../views/text-buffer';
import type { DockViewRegistry } from './registry';

/** Scene tree + Files + Monaco + Output/Problems + Inspector. */
export function registerShellViews(
  registry: DockViewRegistry,
  explorerDeps: FileExplorerDeps,
  editorsDeps: EditorsDeps,
  problemsDeps: ProblemsDeps,
  inspectorDeps: InspectorHostDeps,
  sceneTreeDeps: SceneTreeDeps,
): void {
  registry.register({
    id: SCENE_TREE_VIEW_ID,
    title: 'Scene',
    mount: (container) => mountSceneTree(container, sceneTreeDeps),
  });
  registry.register({
    id: FILE_EXPLORER_VIEW_ID,
    title: 'Files',
    mount: (container) => mountFileExplorer(container, explorerDeps),
  });
  registry.register({
    id: TEXT_BUFFER_VIEW_ID,
    title: 'Editors',
    mount: (container) => mountTextBuffer(container, editorsDeps),
  });
  registry.register({
    id: OUTPUT_VIEW_ID,
    title: 'Output',
    mount: (container) => mountOutput(container),
  });
  registry.register({
    id: PROBLEMS_VIEW_ID,
    title: 'Problems',
    mount: (container) => mountProblems(container, problemsDeps),
  });
  registry.register({
    id: INSPECTOR_VIEW_ID,
    title: 'Inspector',
    mount: (container) => mountInspector(container, inspectorDeps),
  });
}
