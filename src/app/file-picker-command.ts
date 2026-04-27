/**
 * `omosuen.browseForImageFile` host command (Phase 8.3 follow-on).
 *
 * Webview-side trigger: an inspector field with schema `filePicker:
 * { extensions }` renders a "Browse…" button next to its text input;
 * clicking emits `commandInvoke('omosuen.browseForImageFile',
 * [componentId, fieldName])` which the extension-host forwarder routes
 * here.
 *
 * Path convention: paths are stored **workspace-root-relative**
 * (matches `_old/src/panels/inspector.ts:265` —
 * `path.relative(workspaceRoot, selectedPath)`). The texture-map host
 * resolves them back via `vscode.Uri.joinPath(workspaceRoot, filePath)`.
 * This is the project-relative form the user expects ("assets/hero.png"
 * for an image at the workspace's `assets/` folder, regardless of where
 * the .omoscene file lives inside the project).
 *
 * What this command does:
 *   1. Resolve the active controller + target component by id.
 *   2. Look up the field's schema to get the file-extension filter.
 *   3. Show VS Code's native open dialog rooted at the workspace root.
 *   4. Compute a workspace-relative POSIX path from the picked file.
 *   5. Apply the change via `controller.dispatchFromHost` so the broker
 *      fans the update out to inspector + frame editor + preview WS.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import type { DocumentRegistry } from './document-registry.js';
import { componentUpdate } from '../protocol/index.js';
import type { SerializedComponent } from '../omoscene/index.js';
import {
  getComponentSchemas,
  resolveSchema,
  type PropertySchema,
} from '../schema/index.js';

const FALLBACK_EXTENSIONS: readonly string[] = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
];

export function registerFilePickerCommand(
  ctx: vscode.ExtensionContext,
  registry: DocumentRegistry,
): void {
  const cmd = vscode.commands.registerCommand(
    'omosuen.browseForImageFile',
    async (componentIdRaw: unknown, fieldNameRaw: unknown): Promise<void> => {
      if (
        typeof componentIdRaw !== 'number' ||
        !Number.isFinite(componentIdRaw)
      ) {
        void vscode.window.showErrorMessage(
          'Omosuen: Browse-for-file requires a numeric component id.',
        );
        return;
      }
      if (typeof fieldNameRaw !== 'string' || fieldNameRaw === '') {
        void vscode.window.showErrorMessage(
          'Omosuen: Browse-for-file requires a non-empty field name.',
        );
        return;
      }
      const componentId = componentIdRaw;
      const fieldName = fieldNameRaw;

      const controller = registry.activeController.get();
      if (controller === null) {
        void vscode.window.showErrorMessage(
          'Omosuen: open an .omoscene file before browsing for a path.',
        );
        return;
      }

      const file = controller.editorState.sceneDocument.get();
      if (file === null) {
        void vscode.window.showErrorMessage(
          'Omosuen: no scene loaded in the active editor.',
        );
        return;
      }

      const target = findById(file.scene, componentId);
      if (target === null) {
        void vscode.window.showErrorMessage(
          `Omosuen: component id ${String(componentId)} not found in the active scene.`,
        );
        return;
      }

      const extensions = lookupFilePickerExtensions(
        target.type,
        file.engine,
        fieldName,
      );

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;

      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFiles: true,
        canSelectFolders: false,
        filters: { 'Image Files': [...extensions] },
        defaultUri: workspaceRoot,
        openLabel: 'Select',
      });
      if (picked === undefined || picked.length === 0) return;
      const pickedUri = picked[0]!;

      const value = computeStoredPath(workspaceRoot ?? null, pickedUri);

      controller.dispatchFromHost(
        componentUpdate(componentId, target.type, fieldName, value),
      );
    },
  );
  ctx.subscriptions.push(cmd);
}

/**
 * Resolve the workspace-relative POSIX path the user picked. Mirrors
 * `_old`'s convention (`path.relative(workspaceRoot, selectedPath)`):
 * paths are project-relative regardless of where the .omoscene file
 * lives inside the project. Falls back to the picked file's `fsPath`
 * (forward-slash normalized) when there's no workspace, or when the
 * picked file is on a different filesystem root than the workspace
 * (rare; Windows cross-drive selection).
 */
function computeStoredPath(
  workspaceRoot: vscode.Uri | null,
  pickedUri: vscode.Uri,
): string {
  const pickedPath = pickedUri.fsPath;
  if (workspaceRoot === null) return pickedPath.replace(/\\/g, '/');
  const rootPath = workspaceRoot.fsPath;
  const rel = path.relative(rootPath, pickedPath);
  if (rel === '' || path.isAbsolute(rel)) {
    return pickedPath.replace(/\\/g, '/');
  }
  return rel.replace(/\\/g, '/');
}

function lookupFilePickerExtensions(
  componentType: string,
  engineVersion: string,
  fieldName: string,
): readonly string[] {
  const entry = getComponentSchemas(componentType);
  if (entry === null) return FALLBACK_EXTENSIONS;
  const schema = resolveSchema(entry.versions, engineVersion);
  if (schema === null) return FALLBACK_EXTENSIONS;
  const field: PropertySchema | undefined = schema.fields.find(
    (f) => f.name === fieldName,
  );
  if (field === undefined || field.filePicker === undefined) {
    return FALLBACK_EXTENSIONS;
  }
  return field.filePicker.extensions;
}

function findById(
  root: SerializedComponent,
  id: number,
): SerializedComponent | null {
  if (root.id === id) return root;
  const children = Array.isArray(root.components) ? root.components : [];
  for (const child of children) {
    if (typeof child !== 'object' || child === null) continue;
    const c = child as SerializedComponent;
    const hit = findById(c, id);
    if (hit !== null) return hit;
  }
  return null;
}
