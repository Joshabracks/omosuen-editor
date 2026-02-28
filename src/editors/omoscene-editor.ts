/**
 * CustomTextEditorProvider for .omoscene files.
 * Manages the document model and wires up the scene tree,
 * inspector, and preview sync.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseOmoscene, type OmosceneFile } from '../types/omoscene';
import {
  type SerializedComponent,
  type SerializedNexus,
  isSerializedNexus,
} from '../types/engine';
import { SceneTreeProvider } from '../panels/scene-tree';
import { InspectorProvider } from '../panels/inspector';
import { getDevServer } from '../commands/preview';
import { httpsDownloadFile } from '../commands/create-project';

// ── Engine Bundle Resolution ────────────────────────────────────

function getProjectRoot(): string | null {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {return null;}
  return workspaceFolders[0].uri.fsPath;
}

function resolveEnginePath(): string | null {
  const projectRoot = getProjectRoot();
  if (!projectRoot) {return null;}
  const bundlePath = path.join(projectRoot, '.omosuen_editor', 'omosuen.min.js');
  if (fs.existsSync(bundlePath)) {return bundlePath;}
  return null;
}

function resolveFilePath(filePath: string): string | null {
  if (path.isAbsolute(filePath)) {return filePath;}
  const projectRoot = getProjectRoot();
  if (!projectRoot) {return null;}
  return path.join(projectRoot, filePath);
}

function loadImageAsDataUri(filePath: string): string | null {
  const absPath = resolveFilePath(filePath);
  if (!absPath || !fs.existsSync(absPath)) {return null;}
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  };
  const ext = path.extname(absPath).toLowerCase();
  const mime = mimeMap[ext] || 'image/png';
  return `data:${mime};base64,${fs.readFileSync(absPath).toString('base64')}`;
}

// ── Cell-Map Material Interface ──────────────────────────────────

interface CellMapMaterial {
  albedoTextureKey: string;
  normalTextureKey: string;
  emissionTextureKey: string;
  materialTextureKey: string;
  albedoFrame: number;
  normalFrame: number;
  emissionFrame: number;
  materialFrame: number;
}

interface SerializedImageType {
  mode: string;
  cellWidth?: number;
  cellHeight?: number;
  cols?: number;
  rows?: number;
  cellCount?: number;
  frames?: { x: number; y: number; w: number; h: number }[];
}

export class OmosceneEditorProvider
  implements vscode.CustomTextEditorProvider
{
  public static readonly viewType = 'omosuen.omosceneEditor';

  private activeDocument: vscode.TextDocument | null = null;
  private activeParsed: OmosceneFile | null = null;
  private activePanel: vscode.WebviewPanel | null = null;

  constructor(
    private readonly sceneTree: SceneTreeProvider,
    private readonly inspector: InspectorProvider
  ) {}

  /**
   * Get the currently parsed scene data
   */
  getActiveScene(): OmosceneFile | null {
    return this.activeParsed;
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this.activeDocument = document;
    this.activePanel = webviewPanel;

    // Parse the document
    this.activeParsed = parseOmoscene(document.getText());

    // Update scene tree and inspector context
    if (this.activeParsed) {
      this.sceneTree.setScene(this.activeParsed.scene);
      this.inspector.setScene(this.activeParsed.scene);
    }

    // Resolve engine bundle path — download on demand if missing
    let enginePath = resolveEnginePath();
    if (!enginePath && this.activeParsed) {
      const projectRoot = getProjectRoot();
      if (projectRoot && this.activeParsed.engine) {
        const editorDir = path.join(projectRoot, '.omosuen_editor');
        fs.mkdirSync(editorDir, { recursive: true });
        const destPath = path.join(editorDir, 'omosuen.min.js');
        const bundleUrl =
          `https://github.com/Joshabracks/omosuen/releases/download/${this.activeParsed.engine}/omosuen.min.js`;
        try {
          await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Downloading engine bundle...' },
            () => httpsDownloadFile(bundleUrl, destPath)
          );
          enginePath = destPath;
        } catch {
          // Engine not available — fall back to gizmo-only mode
        }
      }
    }

    // Set up webview with engine support
    const engineDir = enginePath ? path.dirname(enginePath) : null;
    const projectRoot = getProjectRoot();
    const localResourceRoots: vscode.Uri[] = [];
    if (engineDir) {localResourceRoots.push(vscode.Uri.file(engineDir));}
    if (projectRoot) {localResourceRoots.push(vscode.Uri.file(projectRoot));}

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: localResourceRoots.length > 0 ? localResourceRoots : undefined,
    };

    const engineUri = enginePath
      ? webviewPanel.webview.asWebviewUri(vscode.Uri.file(enginePath)).toString()
      : null;

    webviewPanel.webview.html = getEditorWebviewHtml(webviewPanel.webview, engineUri);

    // Handle messages from webview
    webviewPanel.webview.onDidReceiveMessage((msg: {
      type: string;
      packedData?: number[];
      cellMapId?: number;
    }) => {
      if (msg.type === 'ready') {
        this.postSceneData(webviewPanel, this.activeParsed);
      } else if (msg.type === 'mapChanged' && msg.cellMapId !== undefined && msg.packedData) {
        this.updateComponentProperty(msg.cellMapId, 'packedData', msg.packedData);
      }
    });

    // Listen for document changes — post updated data without resetting HTML
    const changeSubscription = vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (e.document.uri.toString() === document.uri.toString()) {
          this.activeParsed = parseOmoscene(e.document.getText());
          if (this.activeParsed) {
            this.sceneTree.setScene(this.activeParsed.scene);
            this.inspector.setScene(this.activeParsed.scene);
          }
          this.postSceneData(webviewPanel, this.activeParsed);
        }
      }
    );

    webviewPanel.onDidDispose(() => {
      changeSubscription.dispose();
      if (this.activeDocument === document) {
        this.activeDocument = null;
        this.activeParsed = null;
        this.activePanel = null;
        this.sceneTree.setScene(null);
        this.inspector.setScene(null);
        this.inspector.showComponent(null);
      }
    });
  }

  /**
   * Add a component as a child of the given parent nexus.
   */
  async addComponent(
    parentId: number,
    component: SerializedComponent
  ): Promise<void> {
    if (!this.activeDocument || !this.activeParsed) {return;}

    const updated = JSON.parse(
      JSON.stringify(this.activeParsed)
    ) as OmosceneFile;
    const parent = findComponentById(updated.scene, parentId);
    if (!parent || !isSerializedNexus(parent)) {return;}

    parent.components.push(component);

    await this.writeDocument(updated);

    const server = getDevServer();
    if (server?.isRunning) {
      server.broadcast('component:add', { parentId, component });
    }
  }

  /**
   * Remove a component by ID from the scene.
   */
  async removeComponent(componentId: number): Promise<void> {
    if (!this.activeDocument || !this.activeParsed) {return;}

    const updated = JSON.parse(
      JSON.stringify(this.activeParsed)
    ) as OmosceneFile;
    const parent = findParentNexus(updated.scene, componentId);
    if (!parent) {return;}

    const idx = parent.components.findIndex((c) => c.id === componentId);
    if (idx === -1) {return;}
    parent.components.splice(idx, 1);

    await this.writeDocument(updated);

    const server = getDevServer();
    if (server?.isRunning) {
      server.broadcast('component:remove', { componentId });
    }
  }

  /**
   * Returns the next available component ID (max existing + 1).
   */
  getNextId(): number {
    if (!this.activeParsed) {return 0;}
    return getMaxId(this.activeParsed.scene) + 1;
  }

  /**
   * Move a component to a new parent at a specific index.
   */
  async moveComponent(
    componentId: number,
    newParentId: number,
    index: number
  ): Promise<void> {
    if (!this.activeDocument || !this.activeParsed) {return;}

    const updated = JSON.parse(
      JSON.stringify(this.activeParsed)
    ) as OmosceneFile;

    // Find and remove from old parent
    const oldParent = findParentNexus(updated.scene, componentId);
    if (!oldParent) {return;}

    const oldIdx = oldParent.components.findIndex((c) => c.id === componentId);
    if (oldIdx === -1) {return;}

    const [component] = oldParent.components.splice(oldIdx, 1);

    // Find new parent
    const newParent = findComponentById(updated.scene, newParentId);
    if (!newParent || !isSerializedNexus(newParent)) {return;}

    // Adjust index when moving within the same parent
    let insertIdx = index;
    if (oldParent.id === newParent.id && oldIdx < index) {
      insertIdx--;
    }

    // Clamp to valid range
    insertIdx = Math.max(0, Math.min(insertIdx, newParent.components.length));

    newParent.components.splice(insertIdx, 0, component);

    await this.writeDocument(updated);

    const server = getDevServer();
    if (server?.isRunning) {
      server.broadcast('component:move', {
        componentId,
        oldParentId: oldParent.id,
        newParentId,
        index: insertIdx,
      });
    }
  }

  /**
   * Write an updated OmosceneFile back to the active document.
   */
  private async writeDocument(updated: OmosceneFile): Promise<void> {
    if (!this.activeDocument) {return;}

    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      this.activeDocument.positionAt(0),
      this.activeDocument.positionAt(this.activeDocument.getText().length)
    );
    edit.replace(
      this.activeDocument.uri,
      fullRange,
      JSON.stringify(updated, null, 2)
    );
    await vscode.workspace.applyEdit(edit);
  }

  /**
   * Update a component property in the document
   */
  async updateComponentProperty(
    componentId: number,
    property: string,
    value: unknown
  ): Promise<void> {
    if (!this.activeDocument || !this.activeParsed) {return;}

    // Deep clone and modify
    const updated = JSON.parse(
      JSON.stringify(this.activeParsed)
    ) as OmosceneFile;
    const component = findComponentById(updated.scene, componentId);
    if (!component) {return;}

    // Handle dotted paths (e.g., "textureMapKeys.albedo")
    setNestedValue(component, property, value);

    await this.writeDocument(updated);

    // Send update to preview if running
    const server = getDevServer();
    if (server?.isRunning) {
      server.broadcast('component:update', {
        componentId,
        property,
        value,
      });
    }
  }

  /**
   * Update camera state in the editor metadata (persisted to .omoscene on save)
   */
  updateCameraState(panX: number, panY: number, zoom: number): void {
    if (!this.activeParsed) {return;}
    this.activeParsed.editor.camera = { panX, panY, zoom };
  }

  /**
   * Get the current camera state from editor metadata
   */
  getCameraState(): { panX: number; panY: number; zoom: number } | null {
    if (!this.activeParsed) {return null;}
    return this.activeParsed.editor.camera;
  }

  /**
   * Notify the editor canvas webview of the currently selected entity
   */
  selectEntity(entityId: number): void {
    if (this.activePanel) {
      this.activePanel.webview.postMessage({
        type: 'selection:changed',
        selectedId: entityId,
      });
    }
  }

  /**
   * Enable or disable cell-map editing mode in the webview
   */
  setCellEditMode(enabled: boolean): void {
    if (this.activePanel) {
      this.activePanel.webview.postMessage({
        type: 'cellmap:editMode',
        enabled,
      });
    }
  }

  private postSceneData(
    panel: vscode.WebviewPanel,
    data: OmosceneFile | null
  ): void {
    if (!data) {
      panel.webview.postMessage({
        type: 'scene:data', entities: [], textures: [], colliders: [],
        lights: [], cellMap: null, textureMapUris: [], name: '',
      });
      return;
    }
    const entities = extractEntities(data.scene);
    const colliders = extractColliders(data.scene);
    const lights = extractLights(data.scene);
    const cellMap = extractCellMap(data.scene, panel);

    // Texture map URIs for engine loading (webview-accessible URIs)
    const textureMapUris = collectTextureMapUris(data.scene, panel);

    // Base64-encoded texture images (kept for fallback / palette colors)
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let textures: EditorTextureMap[] = [];
    if (workspaceFolders && workspaceFolders.length > 0) {
      const rawMaps = extractTextureMaps(data.scene);
      textures = loadTextureImages(rawMaps, workspaceFolders[0].uri.fsPath);
    }

    panel.webview.postMessage({
      type: 'scene:data',
      entities,
      textures,
      colliders,
      lights,
      cellMap,
      textureMapUris,
      name: data.name,
    });
  }
}

// ── Helpers ─────────────────────────────────────────────────────

export function findComponentById(
  component: SerializedComponent,
  id: number
): SerializedComponent | null {
  if (component.id === id) {return component;}
  if (isSerializedNexus(component)) {
    for (const child of component.components) {
      const found = findComponentById(child, id);
      if (found) {return found;}
    }
  }
  return null;
}

function findComponentByName(
  root: SerializedComponent,
  name: string
): SerializedComponent | null {
  if (root.name === name) {return root;}
  if (isSerializedNexus(root)) {
    for (const child of root.components) {
      const found = findComponentByName(child, name);
      if (found) {return found;}
    }
  }
  return null;
}

export function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (
      typeof current[parts[i]] !== 'object' ||
      current[parts[i]] === null
    ) {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

export function findParentNexus(
  root: SerializedComponent,
  childId: number
): SerializedNexus | null {
  if (!isSerializedNexus(root)) {return null;}
  for (const child of root.components) {
    if (child.id === childId) {return root;}
    if (isSerializedNexus(child)) {
      const found = findParentNexus(child, childId);
      if (found) {return found;}
    }
  }
  return null;
}

export function getMaxId(component: SerializedComponent): number {
  let max = component.id ?? -1;
  if (isSerializedNexus(component)) {
    for (const child of component.components) {
      const childMax = getMaxId(child);
      if (childMax > max) {max = childMax;}
    }
  }
  return max;
}

export function countComponents(component: SerializedComponent): number {
  let count = 1;
  if (isSerializedNexus(component)) {
    for (const child of component.components) {
      count += countComponents(child);
    }
  }
  return count;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Entity & Texture Extraction ─────────────────────────────────

interface EditorEntity {
  name: string;
  id: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  sprite?: {
    albedoKey: string;
    frameIndex: number;
    anchor: { x: number; y: number };
    tint: { x: number; y: number; z: number; w: number };
    opacity: number;
    showSilhouette: boolean;
    silhouetteColor: { x: number; y: number; z: number; w: number };
  };
  camera?: {
    zoom: number;
    viewportWidth: number;
    viewportHeight: number;
  };
}

interface EditorTextureMap {
  textureMapKey: string;
  imageData: string;
  imageType: { mode: 'grid'; cellWidth: number; cellHeight: number; cols: number; rows: number; cellCount?: number }
           | { mode: 'framemap'; frames: { x: number; y: number; w: number; h: number }[] }
           | null;
}

interface EditorCollider {
  entityName: string;
  entityId: number;
  position: { x: number; y: number; z: number };
  shape: string;
  size: { x: number; y: number; z: number };
  radius: number;
  offset: { x: number; y: number; z: number };
}

interface EditorLight {
  entityName: string;
  entityId: number;
  position: { x: number; y: number; z: number };
  lightType: string;
  color: { x: number; y: number; z: number };
  brightness: number;
  radius: number;
  hardness: number;
  direction: { x: number; y: number; z: number };
}

interface EditorCellMap {
  componentName: string;
  componentId: number;
  materials: CellMapMaterial[];
  materialImageDataUris: (string | null)[];
  packedData: number[];
  cellSize: { x: number; y: number; z: number };
  mapSize: { x: number; y: number; z: number };
  smoothing: number;
  normalSmoothing: number;
}

interface TextureMapUri {
  key: string;
  fileUri: string;
  imageType: SerializedImageType | null;
}

export function extractEntities(scene: SerializedComponent): EditorEntity[] {
  const entities: EditorEntity[] = [];
  walkScene(scene, entities, scene);
  return entities;
}

function walkScene(
  component: SerializedComponent,
  out: EditorEntity[],
  sceneRoot: SerializedComponent
): void {
  if (!isSerializedNexus(component)) {return;}

  // Look for transform, sprite, and camera siblings in this nexus
  const transform = component.components.find((c) => c.type === 'transform');
  const sprite = component.components.find((c) => c.type === 'sprite');
  const camera = component.components.find((c) => c.type === 'camera');

  // Only create an entity if there's a transform, sprite, or camera
  if (transform || sprite || camera) {
    const t = transform as Record<string, unknown> | undefined;
    const s = sprite as Record<string, unknown> | undefined;

    const pos = t?.position as { x: number; y: number; z: number } | undefined;
    const rot = t?.rotation as { x: number; y: number; z: number } | undefined;
    const scl = t?.scale as { x: number; y: number; z: number } | undefined;

    const entity: EditorEntity = {
      name: component.name,
      id: component.id ?? -1,
      position: pos ? { x: pos.x || 0, y: pos.y || 0, z: pos.z || 0 } : { x: 0, y: 0, z: 0 },
      rotation: rot ? { x: rot.x || 0, y: rot.y || 0, z: rot.z || 0 } : { x: 0, y: 0, z: 0 },
      scale: scl ? { x: scl.x ?? 1, y: scl.y ?? 1, z: scl.z ?? 1 } : { x: 1, y: 1, z: 1 },
    };

    if (s) {
      const tmKeys = s.textureMapKeys as { albedo?: string } | undefined;
      const frame = s.frame as { albedo?: number } | undefined;
      const anchor = s.anchor as { x?: number; y?: number } | undefined;
      const tint = s.tint as { x?: number; y?: number; z?: number; w?: number } | undefined;
      const silCol = s.silhouetteColor as { x?: number; y?: number; z?: number; w?: number } | undefined;

      entity.sprite = {
        albedoKey: tmKeys?.albedo || '',
        frameIndex: frame?.albedo ?? 0,
        anchor: { x: anchor?.x || 0, y: anchor?.y || 0 },
        tint: { x: tint?.x ?? 1, y: tint?.y ?? 1, z: tint?.z ?? 1, w: tint?.w ?? 1 },
        opacity: (s.opacity as number) ?? 1,
        showSilhouette: (s.showSilhouette as boolean) ?? false,
        silhouetteColor: { x: silCol?.x ?? 0.2, y: silCol?.y ?? 0.4, z: silCol?.z ?? 0.8, w: silCol?.w ?? 0.5 },
      };
    }

    if (camera) {
      const cam = camera as Record<string, unknown>;
      const cameraZoom = (cam.zoom as number) ?? 1.0;
      const viewportRef = (cam.viewportRef as string) || '';

      let vpWidth = 800;
      let vpHeight = 600;
      if (viewportRef) {
        const vp = findComponentByName(sceneRoot, viewportRef);
        if (vp && vp.type === 'viewport') {
          const vpData = vp as Record<string, unknown>;
          vpWidth = (vpData.width as number) ?? 800;
          vpHeight = (vpData.height as number) ?? 600;
        }
      }

      entity.camera = {
        zoom: cameraZoom,
        viewportWidth: vpWidth,
        viewportHeight: vpHeight,
      };
    }

    out.push(entity);
  }

  // Recurse into child nexuses
  for (const child of component.components) {
    walkScene(child, out, sceneRoot);
  }
}

function extractTextureMaps(scene: SerializedComponent): { key: string; filePath: string; imageType: EditorTextureMap['imageType'] }[] {
  const maps: { key: string; filePath: string; imageType: EditorTextureMap['imageType'] }[] = [];
  walkForTextureMaps(scene, maps);
  return maps;
}

function walkForTextureMaps(
  component: SerializedComponent,
  out: { key: string; filePath: string; imageType: EditorTextureMap['imageType'] }[]
): void {
  if (component.type === 'texture-map') {
    const tm = component as Record<string, unknown>;
    const key = (tm.textureMapKey as string) || '';
    const filePath = (tm.filePath as string) || '';
    if (key && filePath) {
      const imageType = (tm.imageType as EditorTextureMap['imageType']) || null;
      out.push({ key, filePath, imageType });
    }
  }
  if (isSerializedNexus(component)) {
    for (const child of component.components) {
      walkForTextureMaps(child, out);
    }
  }
}

function loadTextureImages(
  maps: { key: string; filePath: string; imageType: EditorTextureMap['imageType'] }[],
  workspaceRoot: string
): EditorTextureMap[] {
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  };

  const result: EditorTextureMap[] = [];
  const seen = new Set<string>();

  for (const tm of maps) {
    if (seen.has(tm.key)) {continue;}
    seen.add(tm.key);

    const absPath = path.isAbsolute(tm.filePath)
      ? tm.filePath
      : path.join(workspaceRoot, tm.filePath);

    if (!fs.existsSync(absPath)) {continue;}

    const ext = path.extname(absPath).toLowerCase();
    const mime = mimeMap[ext] || 'image/png';
    const base64 = fs.readFileSync(absPath).toString('base64');

    result.push({
      textureMapKey: tm.key,
      imageData: `data:${mime};base64,${base64}`,
      imageType: tm.imageType,
    });
  }

  return result;
}

// ── Collider Extraction ──────────────────────────────────────────

function extractColliders(scene: SerializedComponent): EditorCollider[] {
  const colliders: EditorCollider[] = [];
  walkForColliders(scene, colliders);
  return colliders;
}

function walkForColliders(component: SerializedComponent, out: EditorCollider[]): void {
  if (!isSerializedNexus(component)) {return;}
  const transform = component.components.find((c) => c.type === 'transform');
  const collider = component.components.find((c) => c.type === 'collider');
  if (collider) {
    const t = transform as Record<string, unknown> | undefined;
    const c = collider as Record<string, unknown>;
    const pos = t?.position as { x: number; y: number; z: number } | undefined;
    const sz = c.size as { x: number; y: number; z: number } | undefined;
    const off = c.offset as { x: number; y: number; z: number } | undefined;
    out.push({
      entityName: component.name,
      entityId: component.id ?? -1,
      position: pos ? { x: pos.x || 0, y: pos.y || 0, z: pos.z || 0 } : { x: 0, y: 0, z: 0 },
      shape: (c.shape as string) || 'box',
      size: sz ? { x: sz.x ?? 0.5, y: sz.y ?? 0.5, z: sz.z ?? 0.5 } : { x: 0.5, y: 0.5, z: 0.5 },
      radius: (c.radius as number) ?? 0.5,
      offset: off ? { x: off.x || 0, y: off.y || 0, z: off.z || 0 } : { x: 0, y: 0, z: 0 },
    });
  }
  for (const child of component.components) {
    walkForColliders(child, out);
  }
}

// ── Light Extraction ─────────────────────────────────────────────

function extractLights(scene: SerializedComponent): EditorLight[] {
  const lights: EditorLight[] = [];
  walkForLights(scene, lights);
  return lights;
}

function walkForLights(component: SerializedComponent, out: EditorLight[]): void {
  if (!isSerializedNexus(component)) {return;}
  const transform = component.components.find((c) => c.type === 'transform');
  for (const child of component.components) {
    if (child.type === 'light') {
      const t = transform as Record<string, unknown> | undefined;
      const l = child as Record<string, unknown>;
      const pos = t?.position as { x: number; y: number; z: number } | undefined;
      const col = l.color as { x: number; y: number; z: number } | undefined;
      const dir = l.direction as { x: number; y: number; z: number } | undefined;
      out.push({
        entityName: component.name,
        entityId: component.id ?? -1,
        position: pos ? { x: pos.x || 0, y: pos.y || 0, z: pos.z || 0 } : { x: 0, y: 0, z: 0 },
        lightType: (l.lightType as string) || 'ambient',
        color: col ? { x: col.x ?? 1, y: col.y ?? 1, z: col.z ?? 1 } : { x: 1, y: 1, z: 1 },
        brightness: (l.brightness as number) ?? 1,
        radius: (l.radius as number) ?? 100,
        hardness: (l.hardness as number) ?? 0,
        direction: dir ? { x: dir.x || 0, y: dir.y ?? -1, z: dir.z || 0 } : { x: 0, y: -1, z: 0 },
      });
    }
  }
  for (const child of component.components) {
    walkForLights(child, out);
  }
}

// ── Cell-Map Extraction ──────────────────────────────────────────

function extractCellMap(
  scene: SerializedComponent,
  panel: vscode.WebviewPanel
): EditorCellMap | null {
  const cm = findCellMap(scene);
  if (!cm) {return null;}

  const comp = cm as Record<string, unknown>;
  const materials = (comp.materials as CellMapMaterial[]) || [];
  const packedData = (comp.packedData as number[]) || [];
  const cellSize = (comp.cellSize as { x: number; y: number; z: number }) || { x: 1, y: 1, z: 1 };
  const mapSize = (comp.mapSize as { x: number; y: number; z: number }) || { x: 1, y: 1, z: 1 };

  // Load material albedo images as data URIs for palette color sampling
  const materialImageDataUris: (string | null)[] = [];
  for (const mat of materials) {
    if (mat.albedoTextureKey) {
      const tm = findTextureMapByKey(scene, mat.albedoTextureKey);
      if (tm) {
        const filePath = (tm.filePath as string) || '';
        materialImageDataUris.push(filePath ? loadImageAsDataUri(filePath) : null);
      } else {
        materialImageDataUris.push(null);
      }
    } else {
      materialImageDataUris.push(null);
    }
  }

  return {
    componentName: cm.name,
    componentId: cm.id ?? -1,
    materials,
    materialImageDataUris,
    packedData,
    cellSize,
    mapSize,
    smoothing: (comp.smoothing as number) ?? 0,
    normalSmoothing: (comp.normalSmoothing as number) ?? 0,
  };
}

function findCellMap(component: SerializedComponent): SerializedComponent | null {
  if (component.type === 'cell-map') {return component;}
  if (isSerializedNexus(component)) {
    for (const child of component.components) {
      const found = findCellMap(child);
      if (found) {return found;}
    }
  }
  return null;
}

function findTextureMapByKey(
  component: SerializedComponent,
  key: string
): Record<string, unknown> | null {
  if (component.type === 'texture-map') {
    const tm = component as Record<string, unknown>;
    if ((tm.textureMapKey as string) === key) {return tm;}
  }
  if (isSerializedNexus(component)) {
    for (const child of component.components) {
      const found = findTextureMapByKey(child, key);
      if (found) {return found;}
    }
  }
  return null;
}

// ── Texture Map URI Collection (for engine loading) ──────────────

function collectTextureMapUris(
  scene: SerializedComponent,
  panel: vscode.WebviewPanel
): TextureMapUri[] {
  const result: TextureMapUri[] = [];
  walkForTextureMapUris(scene, panel, result);
  return result;
}

function walkForTextureMapUris(
  component: SerializedComponent,
  panel: vscode.WebviewPanel,
  out: TextureMapUri[]
): void {
  if (component.type === 'texture-map') {
    const tm = component as Record<string, unknown>;
    const key = (tm.textureMapKey as string) || '';
    if (key) {
      const filePath = (tm.filePath as string) || '';
      let fileUri = '';
      if (filePath) {
        const absPath = resolveFilePath(filePath);
        if (absPath && fs.existsSync(absPath)) {
          fileUri = panel.webview.asWebviewUri(vscode.Uri.file(absPath)).toString();
        }
      }
      const imageType = (tm.imageType as SerializedImageType) || null;
      out.push({ key, fileUri, imageType });
    }
  }
  if (isSerializedNexus(component)) {
    for (const child of component.components) {
      walkForTextureMapUris(child, panel, out);
    }
  }
}

// ── Editor Webview HTML ─────────────────────────────────────────

function getEditorWebviewHtml(webview: vscode.Webview, engineUri: string | null): string {
  const nonce = getNonce();
  const engineScript = engineUri
    ? `<script src="${engineUri}"></script>`
    : '';
  const cspSrc = engineUri ? ` ${webview.cspSource}` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${webview.cspSource} data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'${cspSrc};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #0d0a07; color: #c8bfb0; font-family: 'IBM Plex Mono', monospace; font-size: 13px; }
  #gizmo-canvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10; }
  #info { position: absolute; top: 8px; right: 8px; color: rgba(200,191,176,0.5); font: 11px 'IBM Plex Mono', monospace; pointer-events: none; z-index: 20; }
  #init-status { position: absolute; top: 8px; left: 8px; color: #d4a843; font: 11px 'IBM Plex Mono', monospace; pointer-events: none; z-index: 20; }

  /* Cell-map editing overlay */
  .control-bar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 100;
    display: none; align-items: center; gap: 10px;
    padding: 6px 10px; background: rgba(21,17,12,0.92); border-bottom: 1px solid #2e2518;
  }
  .control-bar.visible { display: flex; }
  .control-bar label { font-size: 12px; color: #7a7060; }
  .control-bar button {
    background: #1e1810; color: #c8bfb0; border: 1px solid #2e2518; border-radius: 3px;
    padding: 2px 8px; font-family: 'IBM Plex Mono', monospace; font-size: 13px;
    cursor: pointer; min-width: 24px;
  }
  .control-bar button:hover { background: #271f14; border-color: #d4a843; }
  .control-bar .height-val { color: #d4a843; font-weight: bold; min-width: 24px; text-align: center; }
  .control-bar .info { color: #7a7060; margin-left: auto; font-size: 11px; }

  .palette {
    position: fixed; left: 0; top: 34px; bottom: 0; z-index: 100;
    width: 72px; background: rgba(21,17,12,0.92);
    border-right: 1px solid #2e2518; overflow-y: auto;
    display: none; flex-direction: column; align-items: center;
    padding: 6px 0; gap: 4px;
  }
  .palette.visible { display: flex; }
  .palette-item {
    width: 56px; height: 56px; border: 2px solid #2e2518; border-radius: 3px;
    cursor: pointer; position: relative; background: #0d0a07;
    display: flex; align-items: center; justify-content: center;
  }
  .palette-item:hover { border-color: #7a7060; }
  .palette-item.selected { border-color: #d4a843; }
  .palette-item canvas { image-rendering: pixelated; }
  .palette-item .pal-idx {
    position: absolute; bottom: 1px; right: 3px;
    font-size: 9px; color: rgba(200,191,176,0.6);
  }
</style>
</head>
<body>
<canvas id="gizmo-canvas"></canvas>
<div id="info">Editor Preview</div>
<div id="init-status"></div>

<!-- Cell-map editing overlay (hidden by default) -->
<div class="control-bar" id="control-bar">
  <label>Brush Height:</label>
  <button id="height-down">-</button>
  <span class="height-val" id="height-val">0</span>
  <button id="height-up">+</button>
  <span class="info" id="cursor-info"></span>
</div>
<div class="palette" id="palette"></div>

${engineScript}
<script nonce="${nonce}">
(function() {
  'use strict';

  var vscode = acquireVsCodeApi();
  var hasEngine = typeof Omosuen !== 'undefined';

  // ── Constants ──────────────────────────────────────────────
  var COS30 = 0.8660254;
  var SIN30 = 0.5;
  var GIZMO_LEN = 40;
  var AXIS_COLORS = { x: '#c45a4a', y: '#6abc5a', z: '#4a8ac4' };

  // ── DOM refs ────────────────────────────────────────────────
  var gizmoCanvas = document.getElementById('gizmo-canvas');
  var ctx = gizmoCanvas.getContext('2d');
  var infoEl = document.getElementById('info');
  var initStatus = document.getElementById('init-status');
  var controlBar = document.getElementById('control-bar');
  var paletteEl = document.getElementById('palette');
  var heightVal = document.getElementById('height-val');
  var heightDown = document.getElementById('height-down');
  var heightUp = document.getElementById('height-up');
  var cursorInfoEl = document.getElementById('cursor-info');

  // ── State ──────────────────────────────────────────────────
  var entities = [];
  var colliders = [];
  var lights = [];
  var cellMapData = null;
  var textureMapUris = [];
  var sceneName = '';
  var selectedEntityId = -1;
  var engineReady = false;

  // Engine component references
  var viewport = null;
  var camera = null;
  var cameraTransform = null;
  var cellMap = null;
  var inputController = null;
  var engineScene = null;

  // Sprite engine components: entityId → { nexus, transform, sprite }
  var engineEntities = {};
  // Light engine components: index → { nexus?, light }
  var engineLights = [];

  // Cell-map editing mode
  var cellEditMode = false;
  var brushHeight = 0;
  var selectedMaterial = 0;
  var materialImages = [];   // Loaded Image objects per material index
  var editorTextures = [];   // msg.textures (EditorTextureMap[]) for imageType lookups
  var brushTarget = null;
  var suppressNextUpdate = false;

  // ── Projection (matches engine zoom² pipeline) ──────────────
  function worldToScreen(wx, wy, wz) {
    if (!engineReady || !camera || !cameraTransform || !viewport) {
      // Fallback: simple isometric (no engine)
      return { x: gizmoCanvas.width / 2, y: gizmoCanvas.height / 2 };
    }
    var camX = cameraTransform.position.x;
    var camZ = cameraTransform.position.z;
    var zoom = camera.zoom;
    var pixelScale = camera.pixelScale;

    if (pixelScale > 1) {
      var snapSize = pixelScale / zoom;
      camX = Math.floor(camX / snapSize) * snapSize;
      camZ = Math.floor(camZ / snapSize) * snapSize;
    }

    var vpW = viewport.width;
    var vpH = viewport.height;
    var zoomSq = zoom * zoom;

    var isoX = COS30 * wx - COS30 * wz;
    var isoY = SIN30 * wx - wy + SIN30 * wz;
    return {
      x: (isoX - camX) * zoomSq + vpW / 2,
      y: (isoY - camZ) * zoomSq + vpH / 2,
    };
  }

  function screenToWorld(sx, sy, planeY) {
    if (!camera || !cameraTransform || !viewport) return { x: 0, y: 0, z: 0 };
    var camX = cameraTransform.position.x;
    var camZ = cameraTransform.position.z;
    var zoom = camera.zoom;
    var pixelScale = camera.pixelScale;
    if (pixelScale > 1) {
      var snapSize = pixelScale / zoom;
      camX = Math.floor(camX / snapSize) * snapSize;
      camZ = Math.floor(camZ / snapSize) * snapSize;
    }
    var vpW = viewport.width;
    var vpH = viewport.height;
    var zoomSq = zoom * zoom;
    var isoX = (sx - vpW / 2) / zoomSq + camX;
    var isoY = (sy - vpH / 2) / zoomSq + camZ;
    var adjustedIsoY = isoY + planeY;
    var u = adjustedIsoY / SIN30;
    var v = isoX / COS30;
    return { x: (u + v) / 2, y: planeY, z: (u - v) / 2 };
  }

  // ── Gizmo Drawing ──────────────────────────────────────────

  function drawGrid() {
    if (!engineReady) return;
    var gridCells, gridCellW, gridCellZ;
    if (cellMapData) {
      gridCells = Math.max(cellMapData.mapSize.x, cellMapData.mapSize.z);
      gridCellW = cellMapData.cellSize.x;
      gridCellZ = cellMapData.cellSize.z;
    } else {
      gridCells = 16;
      gridCellW = 1;
      gridCellZ = 1;
    }
    var mx = cellMapData ? cellMapData.mapSize.x : gridCells;
    var mz = cellMapData ? cellMapData.mapSize.z : gridCells;

    for (var i = 0; i <= mx; i++) {
      var wx = i * gridCellW;
      var a = worldToScreen(wx, 0, 0);
      var b = worldToScreen(wx, 0, mz * gridCellZ);
      ctx.strokeStyle = (i === 0) ? 'rgba(212,168,67,0.15)' : 'rgba(212,168,67,0.04)';
      ctx.lineWidth = (i === 0) ? 1 : 0.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (var j = 0; j <= mz; j++) {
      var wz = j * gridCellZ;
      var c = worldToScreen(0, 0, wz);
      var d = worldToScreen(mx * gridCellW, 0, wz);
      ctx.strokeStyle = (j === 0) ? 'rgba(212,168,67,0.15)' : 'rgba(212,168,67,0.04)';
      ctx.lineWidth = (j === 0) ? 1 : 0.5;
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
    }
  }

  function drawOrigin() {
    var o = worldToScreen(0, 0, 0);
    var len = 60;
    var xDir = { x: COS30, y: -SIN30 };
    ctx.strokeStyle = AXIS_COLORS.x; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + xDir.x * len, o.y + xDir.y * len); ctx.stroke();
    ctx.fillStyle = AXIS_COLORS.x; ctx.font = "bold 11px 'IBM Plex Mono', monospace";
    ctx.fillText('X', o.x + xDir.x * (len + 6), o.y + xDir.y * (len + 6));

    ctx.strokeStyle = AXIS_COLORS.y; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x, o.y - len); ctx.stroke();
    ctx.fillStyle = AXIS_COLORS.y;
    ctx.fillText('Y', o.x + 4, o.y - len - 4);

    var zDir = { x: -COS30, y: -SIN30 };
    ctx.strokeStyle = AXIS_COLORS.z; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + zDir.x * len, o.y + zDir.y * len); ctx.stroke();
    ctx.fillStyle = AXIS_COLORS.z;
    ctx.fillText('Z', o.x + zDir.x * (len + 6), o.y + zDir.y * (len + 6));

    ctx.fillStyle = '#d4a843';
    ctx.beginPath(); ctx.arc(o.x, o.y, 3, 0, Math.PI * 2); ctx.fill();
  }

  function drawEntityGizmo(e) {
    var p = worldToScreen(e.position.x, e.position.y, e.position.z);
    var len = GIZMO_LEN;
    var isSelected = (e.id === selectedEntityId);
    var lw = isSelected ? 2.5 : 1.5;
    var alpha = isSelected ? 1.0 : 0.7;

    ctx.globalAlpha = alpha;
    var xDir = { x: COS30, y: -SIN30 };
    ctx.strokeStyle = AXIS_COLORS.x; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(p.x - xDir.x * len * 0.3, p.y - xDir.y * len * 0.3);
    ctx.lineTo(p.x + xDir.x * len * 0.7, p.y + xDir.y * len * 0.7); ctx.stroke();

    ctx.strokeStyle = AXIS_COLORS.y;
    ctx.beginPath(); ctx.moveTo(p.x, p.y + len * 0.3);
    ctx.lineTo(p.x, p.y - len * 0.7); ctx.stroke();

    var zDir = { x: -COS30, y: -SIN30 };
    ctx.strokeStyle = AXIS_COLORS.z;
    ctx.beginPath(); ctx.moveTo(p.x - zDir.x * len * 0.3, p.y - zDir.y * len * 0.3);
    ctx.lineTo(p.x + zDir.x * len * 0.7, p.y + zDir.y * len * 0.7); ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = isSelected ? '#d4a843' : '#c8bfb0';
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();

    // Label
    var label = e.name;
    ctx.font = "10px 'IBM Plex Mono', monospace";
    var m = ctx.measureText(label);
    ctx.fillStyle = 'rgba(13, 10, 7, 0.85)';
    ctx.fillRect(p.x - m.width / 2 - 3, p.y - len * 0.7 - 18, m.width + 6, 14);
    ctx.fillStyle = isSelected ? '#d4a843' : '#c8bfb0';
    ctx.fillText(label, p.x - m.width / 2, p.y - len * 0.7 - 7);
  }

  function drawIsoBox(cx, cy, cz, hx, hy, hz, color, lineWidth) {
    var corners = [
      worldToScreen(cx-hx, cy-hy, cz-hz), worldToScreen(cx+hx, cy-hy, cz-hz),
      worldToScreen(cx+hx, cy+hy, cz-hz), worldToScreen(cx-hx, cy+hy, cz-hz),
      worldToScreen(cx-hx, cy-hy, cz+hz), worldToScreen(cx+hx, cy-hy, cz+hz),
      worldToScreen(cx+hx, cy+hy, cz+hz), worldToScreen(cx-hx, cy+hy, cz+hz),
    ];
    var edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
    ctx.beginPath();
    for (var i = 0; i < edges.length; i++) {
      var a = corners[edges[i][0]], b = corners[edges[i][1]];
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  function drawColliderGizmo(c) {
    var isSelected = (c.entityId === selectedEntityId);
    var color = isSelected ? 'rgba(80,220,220,0.9)' : 'rgba(80,220,220,0.4)';
    var lw = isSelected ? 2 : 1;
    var cx = c.position.x + c.offset.x;
    var cy = c.position.y + c.offset.y;
    var cz = c.position.z + c.offset.z;

    if (c.shape === 'sphere') {
      var p = worldToScreen(cx, cy, cz);
      var r = c.radius;
      var edge = worldToScreen(cx + r, cy, cz);
      var screenR = Math.abs(edge.x - p.x);
      ctx.strokeStyle = color; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.arc(p.x, p.y, screenR, 0, Math.PI * 2); ctx.stroke();
    } else {
      drawIsoBox(cx, cy, cz, c.size.x, c.size.y, c.size.z, color, lw);
    }
  }

  function drawLightGizmo(l) {
    var p = worldToScreen(l.position.x, l.position.y, l.position.z);
    var r = Math.round(l.color.x * 255);
    var g = Math.round(l.color.y * 255);
    var b = Math.round(l.color.z * 255);
    var colorStr = 'rgba(' + r + ',' + g + ',' + b + ',0.8)';

    if (l.lightType === 'ambient') return;

    if (l.lightType === 'directional') {
      // Arrow showing direction at top-left corner area
      var ox = 50, oy = 50;
      var dx = l.direction.x, dy = -l.direction.y, dz = l.direction.z;
      var mag = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
      ctx.strokeStyle = colorStr; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ox, oy);
      ctx.lineTo(ox + (dx/mag) * 30, oy + (dy/mag) * 30); ctx.stroke();
      ctx.fillStyle = colorStr;
      ctx.beginPath(); ctx.arc(ox + (dx/mag) * 30, oy + (dy/mag) * 30, 3, 0, Math.PI * 2); ctx.fill();
      ctx.font = "9px 'IBM Plex Mono', monospace";
      ctx.fillText(l.entityName, ox + 8, oy - 8);
      return;
    }

    // Point / spot light
    ctx.fillStyle = colorStr;
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.stroke();

    // Radius indicator
    if (l.radius > 0 && l.radius < 10000) {
      var edge = worldToScreen(l.position.x + l.radius, l.position.y, l.position.z);
      var screenR = Math.abs(edge.x - p.x);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.2)';
      ctx.beginPath(); ctx.arc(p.x, p.y, screenR, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.font = "9px 'IBM Plex Mono', monospace";
    ctx.fillStyle = colorStr;
    ctx.fillText(l.entityName, p.x + 10, p.y - 2);
  }

  function drawCameraRect(e) {
    if (!e.camera) return;
    var p = worldToScreen(e.position.x, e.position.y, e.position.z);
    var zoom = camera ? camera.zoom : 1;
    var zoomSq = zoom * zoom;
    var halfW = (e.camera.viewportWidth / (2 * e.camera.zoom)) * zoomSq;
    var halfH = (e.camera.viewportHeight / (2 * e.camera.zoom)) * zoomSq;
    var isSelected = (e.id === selectedEntityId);
    ctx.strokeStyle = isSelected ? 'rgba(212, 168, 67, 0.9)' : 'rgba(212, 168, 67, 0.3)';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeRect(p.x - halfW, p.y - halfH, halfW * 2, halfH * 2);
  }

  function drawCellHighlight() {
    if (!cellMapData || !engineReady || !cellEditMode || !brushTarget) return;
    var cs = cellMapData.cellSize;
    var bcx = (brushTarget.x + 0.5) * cs.x;
    var bcy = (brushTarget.y + 0.5) * cs.y;
    var bcz = (brushTarget.z + 0.5) * cs.z;
    var isFilled = false;
    if (cellMap) {
      var cd = cellMap.getCellData(new Omosuen.Vector3D(brushTarget.x, brushTarget.y, brushTarget.z));
      isFilled = cd && cd.shapeIndex !== 0;
    }
    if (isFilled) {
      drawIsoBox(bcx, bcy, bcz, cs.x / 2, cs.y / 2, cs.z / 2, 'rgba(80,220,220,0.6)', 2);
    } else {
      ctx.setLineDash([4, 4]);
      drawIsoBox(bcx, bcy, bcz, cs.x / 2, cs.y / 2, cs.z / 2, 'rgba(80,220,220,0.3)', 1);
      ctx.setLineDash([]);
    }
  }

  // ── Gizmo Render ──────────────────────────────────────────
  function renderGizmos() {
    gizmoCanvas.width = gizmoCanvas.clientWidth;
    gizmoCanvas.height = gizmoCanvas.clientHeight;
    ctx.clearRect(0, 0, gizmoCanvas.width, gizmoCanvas.height);

    if (!engineReady) return;

    drawGrid();
    drawOrigin();

    // Collider wireframes
    for (var ci = 0; ci < colliders.length; ci++) {
      drawColliderGizmo(colliders[ci]);
    }

    // Light indicators
    for (var li = 0; li < lights.length; li++) {
      drawLightGizmo(lights[li]);
    }

    // Camera view rects
    for (var k = 0; k < entities.length; k++) {
      if (entities[k].camera) drawCameraRect(entities[k]);
    }

    // Entity axis gizmos + labels
    for (var j = 0; j < entities.length; j++) {
      drawEntityGizmo(entities[j]);
    }

    // Cell highlight
    drawCellHighlight();

    requestAnimationFrame(renderGizmos);
  }

  // ── Engine Scene Creation ──────────────────────────────────
  async function createEditorScene(data) {
    if (!hasEngine) return;
    initStatus.textContent = 'Initializing engine...';
    Omosuen.init();

    var scene = await Omosuen.newComponent('nexus', { name: 'Editor Scene' });
    engineScene = scene;

    // Atlas manager
    var atlasManager = await Omosuen.newComponent('atlas-manager', {
      name: 'EditorAtlas', config: { atlasSize: 4096, maxAtlases: 16, padding: 1 },
    }, scene);

    // Texture maps
    initStatus.textContent = 'Loading textures...';
    var tmUris = data.textureMapUris || [];
    var tmPromises = [];
    for (var i = 0; i < tmUris.length; i++) {
      var tm = tmUris[i];
      if (!tm.fileUri) continue;
      // Convert serialized imageType to engine format
      var engineImageType = undefined;
      if (tm.imageType) {
        if (tm.imageType.mode === 'grid') {
          engineImageType = {
            cellSize: new Omosuen.Vector2D(tm.imageType.cellWidth, tm.imageType.cellHeight),
            gridSize: new Omosuen.Vector2D(tm.imageType.cols, tm.imageType.rows),
            cellCount: tm.imageType.cellCount,
          };
        } else if (tm.imageType.mode === 'framemap' && Array.isArray(tm.imageType.frames)) {
          engineImageType = tm.imageType.frames.map(function(f) {
            return new Omosuen.Vector4D(f.x, f.y, f.w, f.h);
          });
        }
      }
      tmPromises.push(Omosuen.newComponent('texture-map', {
        textureMapKey: tm.key, name: tm.key,
        filePath: tm.fileUri, imageType: engineImageType,
        atlasManager: atlasManager,
      }, scene));
    }
    await Promise.all(tmPromises);

    // Viewport
    initStatus.textContent = 'Creating viewport...';
    viewport = await Omosuen.newComponent('viewport', {
      name: 'EditorViewport', width: window.innerWidth, height: window.innerHeight,
      backgroundColor: new Omosuen.Vector4D(0.05, 0.04, 0.03, 1.0),
    }, scene);

    // Camera
    var camNexus = await Omosuen.newComponent('nexus', { name: 'EditorCamNexus' }, scene);
    cameraTransform = await Omosuen.newComponent('transform', {
      name: 'EditorCamTransform', position: new Omosuen.Vector3D(0, 0, 0),
    }, camNexus);
    camera = await Omosuen.newComponent('camera', {
      name: 'EditorCamera', viewportRef: 'EditorViewport',
      zoom: 0.5, axonometricAngle: 30, pixelScale: 2,
    }, camNexus);

    // Cell map (if present)
    if (data.cellMap) {
      initStatus.textContent = 'Building cell map...';
      var cmd = data.cellMap;
      var ms = new Omosuen.Vector3D(cmd.mapSize.x, cmd.mapSize.y, cmd.mapSize.z);
      var materialMap = new Omosuen.Array3D(ms, 0);
      var shapeMap = new Omosuen.Array3D(ms, 0);
      for (var idx = 0; idx < cmd.packedData.length; idx++) {
        var cell = Omosuen.unpackCell(cmd.packedData[idx]);
        materialMap.indexSet(idx, cell.materialIndex);
        shapeMap.indexSet(idx, cell.shapeIndex);
      }
      cellMap = await Omosuen.newComponent('cell-map', {
        name: cmd.componentName, materials: cmd.materials,
        materialMap: materialMap, shapeMap: shapeMap,
        cellSize: new Omosuen.Vector3D(cmd.cellSize.x, cmd.cellSize.y, cmd.cellSize.z),
        mapSize: ms, smoothing: cmd.smoothing || 0, normalSmoothing: cmd.normalSmoothing || 0,
      }, scene);

      // Center camera on cell map
      var mapWorldW = cmd.mapSize.x * cmd.cellSize.x;
      var mapWorldD = cmd.mapSize.z * cmd.cellSize.z;
      cameraTransform.position = new Omosuen.Vector3D(-mapWorldW / 2, 0, -mapWorldD / 2);
    }

    // Lights
    initStatus.textContent = 'Creating lights...';
    engineLights = [];
    var scLights = data.lights || [];
    for (var li = 0; li < scLights.length; li++) {
      var sl = scLights[li];
      var lightOpts = {
        name: sl.entityName + '_light', lightType: sl.lightType,
        color: new Omosuen.Vector3D(sl.color.x, sl.color.y, sl.color.z),
        brightness: sl.brightness,
      };
      if (sl.lightType === 'directional') {
        lightOpts.direction = new Omosuen.Vector3D(sl.direction.x, sl.direction.y, sl.direction.z);
      }
      if (sl.lightType === 'point' || sl.lightType === 'spot') {
        lightOpts.radius = sl.radius;
        lightOpts.hardness = sl.hardness;
        var lNexus = await Omosuen.newComponent('nexus', { name: sl.entityName + '_lightNexus' }, scene);
        await Omosuen.newComponent('transform', {
          name: sl.entityName + '_lightTransform',
          position: new Omosuen.Vector3D(sl.position.x, sl.position.y, sl.position.z),
        }, lNexus);
        var engineLight = await Omosuen.newComponent('light', lightOpts, lNexus);
        engineLights.push({ nexus: lNexus, light: engineLight });
      } else {
        var engineLight2 = await Omosuen.newComponent('light', lightOpts, scene);
        engineLights.push({ light: engineLight2 });
      }
    }

    // Sprite entities
    initStatus.textContent = 'Creating sprites...';
    engineEntities = {};
    var scEntities = data.entities || [];
    for (var ei = 0; ei < scEntities.length; ei++) {
      var se = scEntities[ei];
      if (!se.sprite || !se.sprite.albedoKey) continue;
      var eNexus = await Omosuen.newComponent('nexus', { name: se.name + '_editorNexus' }, scene);
      var eTransform = await Omosuen.newComponent('transform', {
        name: se.name + '_editorTransform',
        position: new Omosuen.Vector3D(se.position.x, se.position.y, se.position.z),
        rotation: new Omosuen.Vector3D(se.rotation.x, se.rotation.y, se.rotation.z),
        scale: new Omosuen.Vector3D(se.scale.x, se.scale.y, se.scale.z),
      }, eNexus);
      var spriteOpts = {
        name: se.name + '_editorSprite',
        textureMapKeys: { albedo: se.sprite.albedoKey, normal: '', emission: '', material: '' },
        frame: { albedo: se.sprite.frameIndex, normal: 0, emission: 0, material: 0 },
        anchor: new Omosuen.Vector2D(se.sprite.anchor.x, se.sprite.anchor.y),
        tint: new Omosuen.Vector4D(se.sprite.tint.x, se.sprite.tint.y, se.sprite.tint.z, se.sprite.tint.w),
        opacity: se.sprite.opacity,
      };
      var eSprite = await Omosuen.newComponent('sprite', spriteOpts, eNexus);
      engineEntities[se.id] = { nexus: eNexus, transform: eTransform, sprite: eSprite };
    }

    // Input controller
    initStatus.textContent = 'Setting up controls...';
    inputController = await Omosuen.newComponent('input-controller', {
      name: 'EditorInput', preventDefault: false,
    }, scene);

    // Camera pan/zoom bindings
    var isPanning = false, lastMouseX = 0, lastMouseY = 0;
    var PAN_SENSITIVITY = 1.0, ZOOM_ACCEL = 0.003, ZOOM_ENTROPY = 10.75;
    var zoomVelocity = 0, scrollActive = false;

    inputController.onAction('middleMouseDown', function(event) {
      isPanning = true; lastMouseX = event.clientX; lastMouseY = event.clientY;
    });
    inputController.onAction('middleMouseUp', function() { isPanning = false; });
    inputController.onAction('mouseMove', function(event) {
      if (!isPanning) return;
      var dx = event.clientX - lastMouseX, dy = event.clientY - lastMouseY;
      lastMouseX = event.clientX; lastMouseY = event.clientY;
      var zoomSq = camera.zoom * camera.zoom;
      camera.pan(dx * -PAN_SENSITIVITY / zoomSq, dy * -PAN_SENSITIVITY / zoomSq);
    });
    inputController.onAction('mouseWheel', function(event, deltaY) {
      zoomVelocity += -deltaY * ZOOM_ACCEL;
      scrollActive = true;
      camera.setZoomTarget(event.clientX - viewport.offsetX, event.clientY - viewport.offsetY);
    });

    inputController.bindAction({ eventType: 'mousedown', button: 1, action: 'middleMouseDown' });
    inputController.bindAction({ eventType: 'mouseup', button: 1, action: 'middleMouseUp' });
    inputController.bindAction({ eventType: 'mousemove', action: 'mouseMove' });
    inputController.bindAction({ eventType: 'wheel', action: 'mouseWheel' });

    var lastFrameTime = performance.now();
    function zoomLoop() {
      var now = performance.now();
      var dt = Math.min((now - lastFrameTime) / 1000, 0.1);
      lastFrameTime = now;
      if (zoomVelocity !== 0) {
        var newZoom = Math.max(0.1, Math.min(3.0, camera.zoom + zoomVelocity * dt));
        camera.setZoom(newZoom);
        if (!scrollActive) {
          var decay = Math.sign(zoomVelocity) * ZOOM_ENTROPY * Math.abs(zoomVelocity) * dt;
          zoomVelocity -= decay;
          if (Math.abs(zoomVelocity) < 0.0001) { zoomVelocity = 0; camera.resetZoomTarget(); }
        }
      }
      scrollActive = false;
      requestAnimationFrame(zoomLoop);
    }
    requestAnimationFrame(zoomLoop);

    // If no lights were in the scene, add default editor lighting
    if (scLights.length === 0) {
      await Omosuen.newComponent('light', {
        name: 'EditorAmbient', lightType: 'ambient',
        color: new Omosuen.Vector3D(1.0, 0.95, 0.8), brightness: 0.4,
      }, scene);
      var dlNexus = await Omosuen.newComponent('nexus', { name: 'EditorDirNexus' }, scene);
      await Omosuen.newComponent('light', {
        name: 'EditorDir', lightType: 'directional',
        color: new Omosuen.Vector3D(0.7, 0.85, 1.0), brightness: 0.6,
        direction: new Omosuen.Vector3D(0.5, -0.7, 0.3),
      }, dlNexus);
    }

    // Register and start
    initStatus.textContent = 'Starting engine...';
    Omosuen.registerScene('editor', scene);
    await Omosuen.switchScene('editor');
    Omosuen.start(60);

    // Poll for init completion
    var pollId = setInterval(function() {
      var qLen = Omosuen.getInitQueueLength();
      if (qLen === -1) {
        var activeScene = Omosuen.getActiveScene();
        if (activeScene) {
          clearInterval(pollId);
          engineReady = true;
          initStatus.textContent = '';
          // Start gizmo render loop
          requestAnimationFrame(renderGizmos);
        }
      } else {
        var qSize = Omosuen.getInitQueueSize();
        initStatus.textContent = 'Initializing ' + (qLen - qSize) + '/' + qLen + '...';
      }
    }, 100);
  }

  // ── Engine Scene Updates (live patching) ────────────────────
  function updateEngineScene(data) {
    // Cell-map updates
    if (cellMap && data.cellMap) {
      var cmd = data.cellMap;

      // Detect mapSize change — requires full scene recreation
      if (cellMapData && (
        cmd.mapSize.x !== cellMapData.mapSize.x ||
        cmd.mapSize.y !== cellMapData.mapSize.y ||
        cmd.mapSize.z !== cellMapData.mapSize.z
      )) {
        engineReady = false;
        cellMap = null;
        cellMapData = cmd;
        createEditorScene(data).catch(function(err) {
          initStatus.textContent = 'Error: ' + err.message;
          console.error('[Editor] Scene recreation failed:', err);
        });
        return;
      }

      // Patch live-updatable properties
      cellMap.smoothing = cmd.smoothing || 0;
      cellMap.normalSmoothing = cmd.normalSmoothing || 0;
      cellMap.cellSize = new Omosuen.Vector3D(cmd.cellSize.x, cmd.cellSize.y, cmd.cellSize.z);

      // Update packed data → materialMap + shapeMap
      for (var idx = 0; idx < cmd.packedData.length; idx++) {
        var cell = Omosuen.unpackCell(cmd.packedData[idx]);
        cellMap.materialMap.indexSet(idx, cell.materialIndex);
        cellMap.shapeMap.indexSet(idx, cell.shapeIndex);
      }

      // Mark ALL chunks dirty so rebuildDirtyChunks() regenerates meshes
      for (var ci = 0; ci < cellMap.chunks.length; ci++) {
        cellMap.chunks[ci].dirty = true;
      }

      // Update webview cellMapData to reflect latest inspector state
      cellMapData = cmd;
    }

    // Entity transform updates
    var scEntities = data.entities || [];
    for (var ei = 0; ei < scEntities.length; ei++) {
      var se = scEntities[ei];
      var eng = engineEntities[se.id];
      if (eng && eng.transform) {
        eng.transform.position = new Omosuen.Vector3D(se.position.x, se.position.y, se.position.z);
        eng.transform.rotation = new Omosuen.Vector3D(se.rotation.x, se.rotation.y, se.rotation.z);
        eng.transform.scale = new Omosuen.Vector3D(se.scale.x, se.scale.y, se.scale.z);
      }
      if (eng && eng.sprite && se.sprite) {
        eng.sprite.opacity = se.sprite.opacity;
        eng.sprite.tint = new Omosuen.Vector4D(se.sprite.tint.x, se.sprite.tint.y, se.sprite.tint.z, se.sprite.tint.w);
      }
    }
  }

  // ── Cell-Map Editing ───────────────────────────────────────
  function buildPalette() {
    if (!cellMapData) return;
    paletteEl.innerHTML = '';
    for (var i = 0; i < cellMapData.materials.length; i++) {
      var item = document.createElement('div');
      item.className = 'palette-item' + (i === selectedMaterial ? ' selected' : '');
      var tc = document.createElement('canvas');
      tc.width = 48; tc.height = 48;
      drawPaletteSwatch(tc.getContext('2d'), 48, 48, i);
      item.appendChild(tc);
      var idx = document.createElement('span');
      idx.className = 'pal-idx'; idx.textContent = String(i);
      item.appendChild(idx);
      item.addEventListener('click', (function(index) {
        return function() { selectedMaterial = index; buildPalette(); };
      })(i));
      paletteEl.appendChild(item);
    }
  }

  function drawPaletteSwatch(tctx, w, h, matIdx) {
    var img = matIdx < materialImages.length ? materialImages[matIdx] : null;
    if (!img) {
      tctx.fillStyle = '#555';
      tctx.fillRect(0, 0, w, h);
      tctx.fillStyle = '#888';
      tctx.font = "10px 'IBM Plex Mono', monospace";
      tctx.textAlign = 'center';
      tctx.fillText(String(matIdx), w / 2, h / 2 + 3);
      return;
    }

    var mat = cellMapData.materials[matIdx];
    var frameRect = null;
    if (mat && mat.albedoTextureKey) {
      for (var ti = 0; ti < editorTextures.length; ti++) {
        if (editorTextures[ti].textureMapKey === mat.albedoTextureKey && editorTextures[ti].imageType) {
          var it = editorTextures[ti].imageType;
          if (it.mode === 'grid') {
            var frame = mat.albedoFrame || 0;
            var col = frame % it.cols;
            var row = Math.floor(frame / it.cols);
            frameRect = { x: col * it.cellWidth, y: row * it.cellHeight, w: it.cellWidth, h: it.cellHeight };
          } else if (it.mode === 'framemap' && Array.isArray(it.frames)) {
            var fi = mat.albedoFrame || 0;
            if (fi < it.frames.length) {
              frameRect = it.frames[fi];
            }
          }
          break;
        }
      }
    }

    if (frameRect) {
      tctx.drawImage(img, frameRect.x, frameRect.y, frameRect.w, frameRect.h, 0, 0, w, h);
    } else {
      tctx.drawImage(img, 0, 0, w, h);
    }
  }

  function updateBrushTarget(sx, sy) {
    if (!cellMap || !cellMapData || !engineReady) return;
    var canvasEl = viewport.canvas;
    var rect = canvasEl.getBoundingClientRect();
    var mx = sx - rect.left, my = sy - rect.top;
    brushTarget = null;
    var cs = cellMapData.cellSize;
    var ms = cellMapData.mapSize;
    var world = screenToWorld(mx, my, brushHeight * cs.y);
    var cx = Math.floor(world.x / cs.x), cz = Math.floor(world.z / cs.z);
    if (cx >= 0 && cx < ms.x && cz >= 0 && cz < ms.z) {
      brushTarget = { x: cx, y: brushHeight, z: cz };
    }
  }

  function placeCell() {
    if (!brushTarget || !cellMap || !engineReady) return;
    cellMap.setCellData(new Omosuen.Vector3D(brushTarget.x, brushTarget.y, brushTarget.z),
      { materialIndex: selectedMaterial, shapeIndex: 1, emissionIntensity: 0, visible: true });
    emitMapChange();
  }

  function removeCell() {
    if (!brushTarget || !cellMap || !engineReady) return;
    cellMap.setCellData(new Omosuen.Vector3D(brushTarget.x, brushTarget.y, brushTarget.z),
      { materialIndex: 0, shapeIndex: 0, emissionIntensity: 0, visible: true });
    emitMapChange();
  }

  function emitMapChange() {
    if (!cellMap || !cellMapData) return;
    suppressNextUpdate = true;
    var flat = [];
    cellMap.packedData.forEach(function(val) { flat.push(val); });
    vscode.postMessage({ type: 'mapChanged', packedData: flat, cellMapId: cellMapData.componentId });
  }

  function toggleCellEditMode() {
    if (!cellMapData) return;
    cellEditMode = !cellEditMode;
    controlBar.className = 'control-bar' + (cellEditMode ? ' visible' : '');
    paletteEl.className = 'palette' + (cellEditMode ? ' visible' : '');
  }

  // ── Mouse Handlers ──────────────────────────────────────────
  gizmoCanvas.addEventListener('mousedown', function(e) {
    if (!engineReady) return;
    if (e.target.closest('.control-bar') || e.target.closest('.palette')) return;
    if (cellEditMode) {
      if (e.button === 0) { e.preventDefault(); placeCell(); }
      else if (e.button === 2) { e.preventDefault(); removeCell(); }
    }
  });

  gizmoCanvas.addEventListener('mousemove', function(e) {
    if (!engineReady) return;
    if (cellEditMode && cellMapData && cellMap) {
      updateBrushTarget(e.clientX, e.clientY);
      if (cursorInfoEl) {
        cursorInfoEl.textContent = brushTarget
          ? 'Cell: ' + brushTarget.x + ',' + brushTarget.y + ',' + brushTarget.z + ' | Mat: ' + selectedMaterial
          : '';
      }
    }
  });

  gizmoCanvas.addEventListener('contextmenu', function(e) { e.preventDefault(); });

  // Keyboard: T to toggle cell edit mode, q/+/ArrowUp and a/-/ArrowDown for brush height
  document.addEventListener('keydown', function(e) {
    if (e.key === 't' || e.key === 'T') { toggleCellEditMode(); return; }
    if (!cellMapData) return;
    if (e.key === 'ArrowUp' || e.key === 'q' || e.key === 'Q' || e.key === '+') {
      e.preventDefault();
      brushHeight = Math.min(cellMapData.mapSize.y - 1, brushHeight + 1);
      heightVal.textContent = String(brushHeight);
    } else if (e.key === 'ArrowDown' || e.key === 'a' || e.key === 'A' || e.key === '-') {
      e.preventDefault();
      brushHeight = Math.max(0, brushHeight - 1);
      heightVal.textContent = String(brushHeight);
    }
  });

  heightDown.addEventListener('click', function() {
    if (!cellMapData) return;
    brushHeight = Math.max(0, brushHeight - 1); heightVal.textContent = String(brushHeight);
  });
  heightUp.addEventListener('click', function() {
    if (!cellMapData) return;
    brushHeight = Math.min(cellMapData.mapSize.y - 1, brushHeight + 1); heightVal.textContent = String(brushHeight);
  });

  // ── Resize ────────────────────────────────────────────────
  window.addEventListener('resize', function() {
    if (viewport && camera) { viewport.resize(window.innerWidth, window.innerHeight); }
  });

  // ── Message Handler ───────────────────────────────────────
  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (msg.type === 'scene:data') {
      entities = msg.entities || [];
      colliders = msg.colliders || [];
      lights = msg.lights || [];
      cellMapData = msg.cellMap || null;
      textureMapUris = msg.textureMapUris || [];
      sceneName = msg.name || '';

      infoEl.textContent = sceneName
        ? sceneName + ' \\u2014 ' + entities.length + ' entities'
        : 'Editor Preview';

      if (!engineReady && hasEngine) {
        // First load — create engine scene
        createEditorScene(msg).catch(function(err) {
          initStatus.textContent = 'Error: ' + err.message;
          console.error('[Editor] Scene creation failed:', err);
        });

        // Load material texture swatches
        editorTextures = msg.textures || [];
        if (cellMapData) {
          materialImages = [];
          for (var i = 0; i < cellMapData.materials.length; i++) {
            var dataUri = (cellMapData.materialImageDataUris && cellMapData.materialImageDataUris[i]) || null;
            if (dataUri) {
              (function(index, uri) {
                var img = new Image();
                img.onload = function() {
                  materialImages[index] = img;
                  buildPalette();
                };
                img.src = uri;
              })(i, dataUri);
            }
          }
          buildPalette();
        }
      } else if (engineReady) {
        // Subsequent update — patch engine components
        if (suppressNextUpdate) {
          suppressNextUpdate = false;
        } else {
          updateEngineScene(msg);
        }
      }
    }
    if (msg.type === 'selection:changed') {
      selectedEntityId = msg.selectedId !== undefined ? msg.selectedId : -1;
    }
    if (msg.type === 'cellmap:editMode') {
      if (msg.enabled && cellMapData && !cellEditMode) {
        toggleCellEditMode();
      } else if (!msg.enabled && cellEditMode) {
        toggleCellEditMode();
      }
    }
  });

  // Signal ready
  vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
