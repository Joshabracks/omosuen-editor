/**
 * Scene-tree host commands (Post-8 gap-fill + polish pass).
 *
 * Bundles the four mutation commands surfaced from the scene tree's
 * context menu + drag-and-drop:
 *   - `omosuen.addChildComponent(parentId, type?)` — add a new child
 *     under a nexus. With a `type` arg, skips the QuickPick and uses
 *     it directly; without, falls back to QuickPick (palette path).
 *   - `omosuen.deleteComponent(componentId)` — remove a component +
 *     its subtree. Confirmation modal first; selection clears.
 *   - `omosuen.moveComponent(componentId, direction)` — swap the
 *     component with its prior/next sibling. No-op at boundaries.
 *   - `omosuen.reparentComponent(componentId, newParentId)` — move a
 *     component + subtree under a different nexus. Cycle-rejected.
 *
 * All four share the same flow tail: mutate host state via
 * `editorState.dispatch(sceneLoad(mutated))`, then
 * `controller.rebroadcastSceneLoad()` so every registered panel
 * re-hydrates.
 */

import * as vscode from 'vscode';
import { sceneLoad } from '../protocol/index.js';
import type { OmosceneFile, SerializedComponent } from '../omoscene/index.js';
import { listRegisteredComponents } from '../schema/index.js';
import {
  buildDefaultComponent,
  insertChildComponent,
  moveComponent,
  nextComponentId,
  removeComponent,
  reparentComponent,
  type MoveDirection,
} from '../state/index.js';
import type { DocumentController } from './document-controller.js';
import type { DocumentRegistry } from './document-registry.js';

export function registerSceneTreeCommands(
  ctx: vscode.ExtensionContext,
  registry: DocumentRegistry,
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand(
      'omosuen.addChildComponent',
      (parentId: unknown, type: unknown) => runAdd(registry, parentId, type),
    ),
    vscode.commands.registerCommand(
      'omosuen.deleteComponent',
      (componentId: unknown) => runDelete(registry, componentId),
    ),
    vscode.commands.registerCommand(
      'omosuen.moveComponent',
      (componentId: unknown, direction: unknown) =>
        runMove(registry, componentId, direction),
    ),
    vscode.commands.registerCommand(
      'omosuen.reparentComponent',
      (componentId: unknown, newParentId: unknown) =>
        runReparent(registry, componentId, newParentId),
    ),
  );
}

// ---------- add ------------------------------------------------------------

async function runAdd(
  registry: DocumentRegistry,
  rawParentId: unknown,
  rawType: unknown,
): Promise<void> {
  const parentId = requireFiniteNumber(
    rawParentId,
    'Add Child Component requires a numeric parent component id.',
  );
  if (parentId === null) return;

  const ctx = resolveContext(registry);
  if (ctx === null) return;
  const { controller, file } = ctx;

  const parent = findById(file.scene, parentId);
  if (parent === null) {
    void vscode.window.showErrorMessage(
      `Omosuen: no component with id ${String(parentId)} in the current scene.`,
    );
    return;
  }
  if (parent.type !== 'nexus') {
    void vscode.window.showErrorMessage(
      `Omosuen: component id ${String(parentId)} is a "${parent.type}", not a nexus — only nexus components can have children.`,
    );
    return;
  }

  const known = listRegisteredComponents();
  let picked: string | undefined;
  if (typeof rawType === 'string' && rawType !== '') {
    if (!known.includes(rawType)) {
      void vscode.window.showErrorMessage(
        `Omosuen: unknown component type "${rawType}".`,
      );
      return;
    }
    picked = rawType;
  } else {
    picked = await vscode.window.showQuickPick(known.slice().sort(), {
      title: `Add child component under ${describe(parent)}`,
      placeHolder: 'Pick a component type',
      matchOnDescription: true,
    });
    if (picked === undefined) return;
  }

  const newId = nextComponentId(file);
  const newComponent = buildDefaultComponent({
    type: picked,
    id: newId,
    engineVersion: file.engine,
  });

  const mutated = insertChildComponent(file, parentId, newComponent);
  if (mutated === file) {
    void vscode.window.showErrorMessage(
      `Omosuen: could not insert component under id ${String(parentId)}.`,
    );
    return;
  }

  applyMutation(controller, mutated, [newId]);
}

// ---------- delete ---------------------------------------------------------

async function runDelete(
  registry: DocumentRegistry,
  rawComponentId: unknown,
): Promise<void> {
  const componentId = requireFiniteNumber(
    rawComponentId,
    'Delete Component requires a numeric component id.',
  );
  if (componentId === null) return;

  const ctx = resolveContext(registry);
  if (ctx === null) return;
  const { controller, file } = ctx;

  if (file.scene.id === componentId) {
    void vscode.window.showErrorMessage(
      'Omosuen: the root component cannot be deleted.',
    );
    return;
  }

  const target = findById(file.scene, componentId);
  if (target === null) {
    void vscode.window.showErrorMessage(
      `Omosuen: no component with id ${String(componentId)} in the current scene.`,
    );
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Delete ${describe(target)}? This also removes its children.`,
    { modal: true },
    'Delete',
  );
  if (confirm !== 'Delete') return;

  const mutated = removeComponent(file, componentId);
  if (mutated === file) return;

  applyMutation(controller, mutated, []);
}

// ---------- move -----------------------------------------------------------

function runMove(
  registry: DocumentRegistry,
  rawComponentId: unknown,
  rawDirection: unknown,
): void {
  const componentId = requireFiniteNumber(
    rawComponentId,
    'Move Component requires a numeric component id.',
  );
  if (componentId === null) return;
  if (rawDirection !== 'up' && rawDirection !== 'down') {
    void vscode.window.showErrorMessage(
      'Omosuen: Move Component direction must be "up" or "down".',
    );
    return;
  }
  const direction = rawDirection as MoveDirection;

  const ctx = resolveContext(registry);
  if (ctx === null) return;
  const { controller, file } = ctx;

  const mutated = moveComponent(file, componentId, direction);
  if (mutated === file) return;

  // Preserve existing selection on the moved component.
  applyMutation(controller, mutated, file.editor.selection);
}

// ---------- reparent -------------------------------------------------------

function runReparent(
  registry: DocumentRegistry,
  rawComponentId: unknown,
  rawNewParentId: unknown,
): void {
  const componentId = requireFiniteNumber(
    rawComponentId,
    'Reparent Component requires a numeric component id.',
  );
  if (componentId === null) return;
  const newParentId = requireFiniteNumber(
    rawNewParentId,
    'Reparent Component requires a numeric new-parent id.',
  );
  if (newParentId === null) return;

  const ctx = resolveContext(registry);
  if (ctx === null) return;
  const { controller, file } = ctx;

  const mutated = reparentComponent(file, componentId, newParentId);
  if (mutated === file) return;

  applyMutation(controller, mutated, [componentId]);
}

// ---------- shared helpers ------------------------------------------------

interface ResolvedContext {
  readonly controller: DocumentController;
  readonly file: OmosceneFile;
}

function resolveContext(registry: DocumentRegistry): ResolvedContext | null {
  const controller = registry.activeController.get();
  if (controller === null) {
    void vscode.window.showErrorMessage(
      'Omosuen: open an .omoscene file before using scene-tree commands.',
    );
    return null;
  }
  const file = controller.editorState.sceneDocument.get();
  if (file === null) {
    void vscode.window.showErrorMessage(
      'Omosuen: no scene is loaded in the active document.',
    );
    return null;
  }
  return { controller, file };
}

function applyMutation(
  controller: DocumentController,
  mutated: OmosceneFile,
  selection: readonly number[],
): void {
  const withSelection: OmosceneFile = {
    ...mutated,
    editor: { ...mutated.editor, selection: [...selection] },
  };
  controller.editorState.dispatch(sceneLoad(withSelection));
  controller.rebroadcastSceneLoad();
}

function requireFiniteNumber(value: unknown, errorMsg: string): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    void vscode.window.showErrorMessage(`Omosuen: ${errorMsg}`);
    return null;
  }
  return value;
}

function findById(
  root: SerializedComponent,
  id: number,
): SerializedComponent | null {
  if (root.id === id) return root;
  if (!Array.isArray(root.components)) return null;
  for (const child of root.components) {
    if (typeof child !== 'object' || child === null) continue;
    const c = child as SerializedComponent;
    const hit = findById(c, id);
    if (hit !== null) return hit;
  }
  return null;
}

function describe(node: SerializedComponent): string {
  if (typeof node.name === 'string' && node.name !== '') {
    return `${node.type} "${node.name}"`;
  }
  return `${node.type} (id=${String(node.id)})`;
}
