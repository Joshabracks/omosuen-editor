import {
  FILE_EXPLORER_VIEW_ID,
  mountFileExplorer,
  type FileExplorerDeps,
} from '../views/file-explorer';
import { mountOutput, OUTPUT_VIEW_ID } from '../views/output';
import {
  mountProblems,
  PROBLEMS_VIEW_ID,
  type ProblemsDeps,
} from '../views/problems';
import {
  mountTextBuffer,
  TEXT_BUFFER_VIEW_ID,
  type EditorsDeps,
} from '../views/text-buffer';
import type { DockViewRegistry } from './registry';

/** File explorer + Monaco + Output/Problems (kept out of registry.ts for Node tests). */
export function registerShellViews(
  registry: DockViewRegistry,
  explorerDeps: FileExplorerDeps,
  editorsDeps: EditorsDeps,
  problemsDeps: ProblemsDeps,
): void {
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
}
