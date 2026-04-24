/**
 * Scene tree — native VS Code `TreeDataProvider` (replaces the
 * previous `WebviewView`).
 *
 * Why: webview views are iframe-bounded, so a custom HTML context
 * menu can't render outside the sidebar's width. The `_old/` editor
 * avoided the issue by using VS Code's native tree API, whose menus
 * are drawn in the editor chrome and therefore unbounded. This module
 * brings that approach into the rebuild.
 *
 * Sync invariant — the rebuild exists to keep every panel aligned on
 * one canonical document. The tree provider upholds that by:
 *   - Running in the extension host (no bridge, no cross-iframe I/O).
 *   - Reading directly from `DocumentController.editorState` stores;
 *     the broker already updates those whenever a webview dispatches.
 *   - Writing through `DocumentController.dispatchFromHost(msg)` for
 *     user-driven selection, and through the existing scene-tree
 *     commands for mutations (add/delete/move/reparent). Both paths
 *     apply to host state AND broadcast to every registered bridge
 *     panel, so the inspector and preview see tree-originated events
 *     exactly as they'd see webview-originated ones.
 *
 * Active-document handling mirrors `followActiveController` in
 * [document-registry.ts](./document-registry.ts): the provider
 * watches `registry.activeController`, re-binding its store
 * subscriptions whenever the user switches `.omoscene` tabs.
 */

import * as vscode from 'vscode';
import { componentSelect } from '../protocol/index.js';
import type { SerializedComponent } from '../omoscene/index.js';
import type { DocumentController } from './document-controller.js';
import type { DocumentRegistry } from './document-registry.js';

export class ComponentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly component: SerializedComponent,
    public readonly parentId: number | null,
    collapsibleState: vscode.TreeItemCollapsibleState,
    iconUri: vscode.Uri | null,
  ) {
    const displayName =
      typeof component.name === 'string' && component.name !== ''
        ? component.name
        : component.type;
    super(displayName, collapsibleState);
    // `id` is how VS Code identifies the item across refreshes —
    // stable across a `fire(undefined)` so selection persists.
    if (typeof component.id === 'number') {
      this.id = String(component.id);
    }
    // Per-type context value gates `view/item/context` menu
    // contributions. The scene root uses a distinct `root` value
    // so Delete / Move Up / Move Down can hide themselves on the
    // undeletable top-level nexus while still offering Add
    // Component on its (and any other nexus's) children.
    this.contextValue = parentId === null ? 'root' : component.type;
    this.tooltip = `${component.type} (id=${String(component.id)})`;
    if (iconUri !== null) {
      this.iconPath = iconUri;
    }
  }
}

export function registerSceneTreeProvider(
  ctx: vscode.ExtensionContext,
  registry: DocumentRegistry,
): void {
  const provider = new SceneTreeProvider(ctx, registry);
  const treeView = vscode.window.createTreeView<ComponentTreeItem>(
    'omosuen.sceneTree',
    {
      treeDataProvider: provider,
      dragAndDropController: provider,
      canSelectMany: false,
      showCollapseAll: true,
    },
  );
  provider.attachView(treeView);
  ctx.subscriptions.push(treeView, provider);
}

class SceneTreeProvider
  implements
    vscode.TreeDataProvider<ComponentTreeItem>,
    vscode.TreeDragAndDropController<ComponentTreeItem>,
    vscode.Disposable
{
  readonly dragMimeTypes = ['application/vnd.omosuen.component'];
  readonly dropMimeTypes = ['application/vnd.omosuen.component'];

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    ComponentTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly iconsBase: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly selectionSubscription: { dispose(): void };
  private readonly documentSubscription: { dispose(): void };
  private readonly activeControllerSubscription: { dispose(): void };

  private treeView: vscode.TreeView<ComponentTreeItem> | null = null;
  private activeController: DocumentController | null = null;
  private perControllerUnsub: (() => void)[] = [];
  // Avoid echoing a `component:select` we just dispatched: when the
  // broker applies it, our selection subscriber fires and would call
  // `treeView.reveal` on a row that's already selected in the tree —
  // benign but slightly janky (scroll reset). This flag short-circuits
  // one reveal per round-trip.
  private suppressNextRevealFromSelection = false;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly registry: DocumentRegistry,
  ) {
    this.iconsBase = vscode.Uri.joinPath(
      ctx.extensionUri,
      'media',
      'icons',
      'components',
    );

    // Rebind on active-controller change. The registry store is the
    // same one `followActiveController` uses for sidebar webviews, so
    // this keeps the tree in lockstep with whichever `.omoscene` the
    // user is focused on.
    this.activeControllerSubscription = {
      dispose: registry.activeController.subscribe((controller) => {
        this.rebindActiveController(controller);
      }),
    };
    // Bind once on boot for whichever controller is already active.
    this.activeController = registry.activeController.get();
    if (this.activeController !== null) {
      this.subscribeToController(this.activeController);
    }

    // Placeholders so TS knows these fields are initialised. Real
    // subscriptions are managed per-controller inside
    // `subscribeToController`.
    this.selectionSubscription = { dispose: (): void => undefined };
    this.documentSubscription = { dispose: (): void => undefined };
  }

  attachView(view: vscode.TreeView<ComponentTreeItem>): void {
    this.treeView = view;

    // User-driven selection in the native tree → dispatch through the
    // host broker so inspector / preview / other panels see the same
    // selection. `dispatchFromHost` applies to canonical state AND
    // broadcasts to every registered bridge.
    this.disposables.push(
      view.onDidChangeSelection((ev) => {
        const item = ev.selection[0];
        if (item === undefined) return;
        const controller = this.activeController;
        if (controller === null) return;
        const id = item.component.id;
        if (typeof id !== 'number') return;
        this.suppressNextRevealFromSelection = true;
        controller.dispatchFromHost(componentSelect([id]));
      }),
    );
  }

  getTreeItem(element: ComponentTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ComponentTreeItem): ComponentTreeItem[] {
    const controller = this.activeController;
    if (controller === null) return [];
    const file = controller.editorState.sceneDocument.get();
    if (file === null) return [];

    if (element === undefined) {
      // Root: always a nexus per the OmosceneFile type.
      return [this.makeItem(file.scene, null)];
    }

    if (!Array.isArray(element.component.components)) return [];
    return element.component.components
      .filter(
        (child): child is SerializedComponent =>
          typeof child === 'object' &&
          child !== null &&
          typeof (child as { type?: unknown }).type === 'string',
      )
      .map((child) =>
        this.makeItem(
          child,
          typeof element.component.id === 'number'
            ? element.component.id
            : null,
        ),
      );
  }

  getParent(element: ComponentTreeItem): ComponentTreeItem | null {
    // Required for `TreeView.reveal` to walk up from a target to
    // whatever ancestor is currently expanded. We resolve the parent
    // by id from the current document.
    const controller = this.activeController;
    if (controller === null || element.parentId === null) return null;
    const file = controller.editorState.sceneDocument.get();
    if (file === null) return null;
    const parent = findById(file.scene, element.parentId);
    if (parent === null) return null;
    const grandparentId = findParentId(file.scene, parent.id ?? -1, null);
    return this.makeItem(parent, grandparentId);
  }

  handleDrag(
    source: readonly ComponentTreeItem[],
    dataTransfer: vscode.DataTransfer,
  ): void {
    const item = source[0];
    if (item === undefined) return;
    const controller = this.activeController;
    if (controller === null) return;
    const file = controller.editorState.sceneDocument.get();
    if (file === null) return;
    // Block dragging the root — it has no parent to leave.
    if (item.component.id === file.scene.id) return;

    dataTransfer.set(
      'application/vnd.omosuen.component',
      new vscode.DataTransferItem(String(item.component.id ?? '')),
    );
  }

  async handleDrop(
    target: ComponentTreeItem | undefined,
    dataTransfer: vscode.DataTransfer,
  ): Promise<void> {
    if (target === undefined) return;
    const raw = dataTransfer.get('application/vnd.omosuen.component');
    if (raw === undefined) return;
    const value =
      typeof raw.value === 'string'
        ? raw.value
        : await Promise.resolve(raw.asString());
    const sourceId = Number.parseInt(value, 10);
    if (!Number.isFinite(sourceId)) return;

    // Drop resolution mirrors `_old`'s scene tree: dropping onto a
    // nexus makes the source its child; dropping onto a non-nexus
    // reparents into that row's OWN parent (so you can reorder among
    // siblings). For MVP we only handle the nexus case — non-nexus
    // drops are a no-op because our `omosuen.reparentComponent` rejects
    // non-nexus targets at the mutation layer.
    const newParentId = target.component.id;
    if (typeof newParentId !== 'number') return;

    await vscode.commands.executeCommand(
      'omosuen.reparentComponent',
      sourceId,
      newParentId,
    );
  }

  dispose(): void {
    this.activeControllerSubscription.dispose();
    this.unsubscribeFromController();
    for (const d of this.disposables) d.dispose();
    this._onDidChangeTreeData.dispose();
  }

  // --- internals ----------------------------------------------------

  private rebindActiveController(controller: DocumentController | null): void {
    if (controller === this.activeController) return;
    this.unsubscribeFromController();
    this.activeController = controller;
    if (controller !== null) {
      this.subscribeToController(controller);
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  private subscribeToController(controller: DocumentController): void {
    const docUnsub = controller.editorState.sceneDocument.subscribe(() => {
      this._onDidChangeTreeData.fire(undefined);
    });
    const selUnsub = controller.editorState.selection.subscribe((ids) => {
      // Canonical selection changed — reflect it in the tree. Skip
      // one reveal if we just dispatched this same message from a
      // user click in the tree (avoids a round-trip scroll).
      if (this.suppressNextRevealFromSelection) {
        this.suppressNextRevealFromSelection = false;
        return;
      }
      const id = ids[0];
      if (id === undefined) return;
      void this.revealById(controller, id);
    });
    this.perControllerUnsub.push(docUnsub, selUnsub);
  }

  private unsubscribeFromController(): void {
    for (const u of this.perControllerUnsub) u();
    this.perControllerUnsub = [];
  }

  private async revealById(
    controller: DocumentController,
    id: number,
  ): Promise<void> {
    if (this.treeView === null) return;
    const file = controller.editorState.sceneDocument.get();
    if (file === null) return;
    const component = findById(file.scene, id);
    if (component === null) return;
    const parentId = findParentId(file.scene, id, null);
    const item = this.makeItem(component, parentId);
    try {
      await this.treeView.reveal(item, {
        select: true,
        focus: false,
        expand: true,
      });
    } catch {
      // `reveal` can reject if the view isn't currently visible —
      // swallow: the selection state is already correct in the store.
    }
  }

  private makeItem(
    component: SerializedComponent,
    parentId: number | null,
  ): ComponentTreeItem {
    const hasChildren =
      component.type === 'nexus' &&
      Array.isArray(component.components) &&
      component.components.length > 0;
    const state = hasChildren
      ? vscode.TreeItemCollapsibleState.Expanded
      : component.type === 'nexus'
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;
    return new ComponentTreeItem(
      component,
      parentId,
      state,
      this.iconUriFor(component.type),
    );
  }

  private iconUriFor(type: string): vscode.Uri | null {
    // Component type names match `[a-z][a-z0-9-]*` per the schema
    // registry, so direct interpolation into the URI is safe.
    return vscode.Uri.joinPath(this.iconsBase, `${type}.svg`);
  }
}

function findById(
  root: SerializedComponent,
  id: number,
): SerializedComponent | null {
  if (root.id === id) return root;
  if (!Array.isArray(root.components)) return null;
  for (const child of root.components) {
    if (typeof child !== 'object' || child === null) continue;
    const hit = findById(child, id);
    if (hit !== null) return hit;
  }
  return null;
}

function findParentId(
  node: SerializedComponent,
  id: number,
  parentId: number | null,
): number | null {
  if (node.id === id) return parentId;
  if (!Array.isArray(node.components)) return null;
  const nodeId = typeof node.id === 'number' ? node.id : null;
  for (const child of node.components) {
    if (typeof child !== 'object' || child === null) continue;
    const hit = findParentId(child, id, nodeId);
    if (hit !== null) return hit;
  }
  return null;
}
