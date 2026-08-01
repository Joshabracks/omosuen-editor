import {
  FILE_EXPLORER_VIEW_ID,
  mountFileExplorer,
  type FileExplorerDeps,
} from '../views/file-explorer';
import {
  mountTextBuffer,
  TEXT_BUFFER_VIEW_ID,
  type EditorsDeps,
} from '../views/text-buffer';
import type { DockViewRegistry } from './registry';

/** File explorer + Monaco editors host (kept out of registry.ts for Node tests). */
export function registerShellViews(
  registry: DockViewRegistry,
  explorerDeps: FileExplorerDeps,
  editorsDeps: EditorsDeps,
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
}
