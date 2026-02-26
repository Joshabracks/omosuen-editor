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

    // Set up the webview with the editor canvas (set HTML once)
    webviewPanel.webview.options = { enableScripts: true };
    webviewPanel.webview.html = getEditorWebviewHtml(webviewPanel.webview);

    // Post initial scene data
    this.postSceneData(webviewPanel, this.activeParsed);

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

  private postSceneData(
    panel: vscode.WebviewPanel,
    data: OmosceneFile | null
  ): void {
    if (!data) {
      panel.webview.postMessage({ type: 'scene:data', entities: [], textures: [], name: '' });
      return;
    }
    const entities = extractEntities(data.scene);

    // Extract and load texture map images for sprite rendering
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

// ── Editor Webview HTML ─────────────────────────────────────────

function getEditorWebviewHtml(_webview: vscode.Webview): string {
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #1e1e1e; }
  canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
  #info { position: absolute; top: 8px; left: 8px; color: rgba(255,255,255,0.4); font: 11px monospace; pointer-events: none; }
</style>
</head>
<body>
<canvas id="editor-canvas"></canvas>
<div id="info">Editor Preview</div>
<script nonce="${nonce}">
(function() {
  'use strict';

  var COS30 = 0.8660254;
  var SIN30 = 0.5;
  var GRID_CELLS = 20;
  var CELL_SIZE = 32;
  var GIZMO_LEN = 40;
  var AXIS_COLORS = { x: '#FF4444', y: '#44FF44', z: '#4488FF' };

  var canvas = document.getElementById('editor-canvas');
  var ctx = canvas.getContext('2d');
  var infoEl = document.getElementById('info');

  // Camera state (editor-local)
  var cam = { panX: 0, panY: 0, zoom: 1.5 };
  var entities = [];
  var textures = {};  // textureMapKey → { img: HTMLImageElement, imageType: ... }
  var sceneName = '';
  var selectedEntityId = -1;
  var offscreen = document.createElement('canvas');
  var offCtx = offscreen.getContext('2d');

  // Dragging state
  var dragging = false;
  var dragStart = { x: 0, y: 0 };
  var camStart = { x: 0, y: 0 };

  // ── Projection ──────────────────────────────────────────────
  function worldToScreen(wx, wy, wz) {
    var isoX = COS30 * wx - COS30 * wz;
    var isoY = SIN30 * wx - wy + SIN30 * wz;
    return {
      x: (isoX - cam.panX) * cam.zoom + canvas.width / 2,
      y: canvas.height / 2 - (isoY - cam.panY) * cam.zoom,
    };
  }

  // ── Frame Extraction ──────────────────────────────────────────
  function getFrameRect(imageType, frameIndex, imgW, imgH) {
    if (!imageType) {
      return { x: 0, y: 0, w: imgW, h: imgH };
    }
    if (imageType.mode === 'grid') {
      var col = frameIndex % imageType.cols;
      var row = Math.floor(frameIndex / imageType.cols);
      return {
        x: col * imageType.cellWidth,
        y: row * imageType.cellHeight,
        w: imageType.cellWidth,
        h: imageType.cellHeight,
      };
    }
    if (imageType.mode === 'framemap' && imageType.frames && imageType.frames[frameIndex]) {
      var f = imageType.frames[frameIndex];
      return { x: f.x, y: f.y, w: f.w, h: f.h };
    }
    return { x: 0, y: 0, w: imgW, h: imgH };
  }

  // ── Grid ────────────────────────────────────────────────────
  function drawGrid() {
    var half = GRID_CELLS;
    for (var i = -half; i <= half; i++) {
      var w = i * CELL_SIZE;
      var extent = half * CELL_SIZE;

      // Lines along X (varying Z)
      var a1 = worldToScreen(-extent, 0, w);
      var b1 = worldToScreen(extent, 0, w);
      ctx.strokeStyle = (i === 0) ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.07)';
      ctx.lineWidth = (i === 0) ? 1 : 0.5;
      ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(b1.x, b1.y); ctx.stroke();

      // Lines along Z (varying X)
      var a2 = worldToScreen(w, 0, -extent);
      var b2 = worldToScreen(w, 0, extent);
      ctx.beginPath(); ctx.moveTo(a2.x, a2.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
    }
  }

  // ── Origin Indicator ────────────────────────────────────────
  function drawOrigin() {
    var o = worldToScreen(0, 0, 0);
    var len = 60;

    // X axis
    var xDir = { x: COS30, y: -SIN30 };
    ctx.strokeStyle = AXIS_COLORS.x; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + xDir.x * len, o.y + xDir.y * len); ctx.stroke();
    ctx.fillStyle = AXIS_COLORS.x; ctx.font = 'bold 11px monospace';
    ctx.fillText('X', o.x + xDir.x * (len + 6), o.y + xDir.y * (len + 6));

    // Y axis (straight up in screen space)
    ctx.strokeStyle = AXIS_COLORS.y; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x, o.y - len); ctx.stroke();
    ctx.fillStyle = AXIS_COLORS.y;
    ctx.fillText('Y', o.x + 4, o.y - len - 4);

    // Z axis
    var zDir = { x: -COS30, y: -SIN30 };
    ctx.strokeStyle = AXIS_COLORS.z; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + zDir.x * len, o.y + zDir.y * len); ctx.stroke();
    ctx.fillStyle = AXIS_COLORS.z;
    ctx.fillText('Z', o.x + zDir.x * (len + 6), o.y + zDir.y * (len + 6));

    // Origin dot
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(o.x, o.y, 3, 0, Math.PI * 2); ctx.fill();
  }

  // ── Entity Crosshairs ──────────────────────────────────────
  function drawEntity(e) {
    var p = worldToScreen(e.position.x, e.position.y, e.position.z);
    var len = GIZMO_LEN;

    // X axis
    var xDir = { x: COS30, y: -SIN30 };
    ctx.strokeStyle = AXIS_COLORS.x; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(p.x - xDir.x * len * 0.3, p.y - xDir.y * len * 0.3);
    ctx.lineTo(p.x + xDir.x * len * 0.7, p.y + xDir.y * len * 0.7); ctx.stroke();

    // Y axis
    ctx.strokeStyle = AXIS_COLORS.y;
    ctx.beginPath(); ctx.moveTo(p.x, p.y + len * 0.3);
    ctx.lineTo(p.x, p.y - len * 0.7); ctx.stroke();

    // Z axis
    var zDir = { x: -COS30, y: -SIN30 };
    ctx.strokeStyle = AXIS_COLORS.z;
    ctx.beginPath(); ctx.moveTo(p.x - zDir.x * len * 0.3, p.y - zDir.y * len * 0.3);
    ctx.lineTo(p.x + zDir.x * len * 0.7, p.y + zDir.y * len * 0.7); ctx.stroke();

    // Center dot
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();

    // Label
    var label = e.name + ' (' + e.position.x.toFixed(0) + ',' + e.position.y.toFixed(0) + ',' + e.position.z.toFixed(0) + ')';
    ctx.font = '10px monospace';
    var m = ctx.measureText(label);
    ctx.fillStyle = 'rgba(30, 30, 30, 0.8)';
    ctx.fillRect(p.x - m.width / 2 - 3, p.y - len * 0.7 - 18, m.width + 6, 14);
    ctx.fillStyle = '#ccc';
    ctx.fillText(label, p.x - m.width / 2, p.y - len * 0.7 - 7);
  }

  // ── Sprite Rendering ──────────────────────────────────────────
  function drawSprite(e) {
    if (!e.sprite || !e.sprite.albedoKey) return;
    var entry = textures[e.sprite.albedoKey];
    if (!entry || !entry.img || !entry.img.complete) return;

    var img = entry.img;
    var fr = getFrameRect(entry.imageType, e.sprite.frameIndex, img.width, img.height);
    if (fr.w <= 0 || fr.h <= 0) return;

    var p = worldToScreen(e.position.x, e.position.y, e.position.z);

    // Anchor offset (shader: anchoredPosition = isoProjected - anchor)
    var ax = p.x - e.sprite.anchor.x * cam.zoom;
    var ay = p.y - e.sprite.anchor.y * cam.zoom;

    var drawW = fr.w * cam.zoom;
    var drawH = fr.h * cam.zoom;

    var tint = e.sprite.tint;
    var opacity = e.sprite.opacity;
    var needsTint = !(tint.x >= 0.99 && tint.y >= 0.99 && tint.z >= 0.99);
    var needsAlpha = opacity < 0.99 || tint.w < 0.99;

    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(e.rotation.z);
    ctx.scale(e.scale.x, e.scale.y);

    // Silhouette indicator (drawn behind sprite)
    if (e.sprite.showSilhouette) {
      var sc = e.sprite.silhouetteColor;
      ctx.globalAlpha = sc.w * 0.6;
      ctx.shadowColor = 'rgba(' + Math.round(sc.x * 255) + ',' + Math.round(sc.y * 255) + ',' + Math.round(sc.z * 255) + ',1)';
      ctx.shadowBlur = 6;
      ctx.drawImage(img, fr.x, fr.y, fr.w, fr.h, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    if (needsTint) {
      // Tint via offscreen canvas
      var ow = Math.ceil(drawW);
      var oh = Math.ceil(drawH);
      if (ow > 0 && oh > 0) {
        offscreen.width = ow;
        offscreen.height = oh;
        offCtx.clearRect(0, 0, ow, oh);
        offCtx.imageSmoothingEnabled = false;

        // Draw the sprite frame
        offCtx.drawImage(img, fr.x, fr.y, fr.w, fr.h, 0, 0, ow, oh);

        // Multiply tint
        offCtx.globalCompositeOperation = 'multiply';
        offCtx.fillStyle = 'rgb(' + Math.round(tint.x * 255) + ',' + Math.round(tint.y * 255) + ',' + Math.round(tint.z * 255) + ')';
        offCtx.fillRect(0, 0, ow, oh);

        // Restore original alpha
        offCtx.globalCompositeOperation = 'destination-in';
        offCtx.drawImage(img, fr.x, fr.y, fr.w, fr.h, 0, 0, ow, oh);
        offCtx.globalCompositeOperation = 'source-over';

        ctx.globalAlpha = needsAlpha ? opacity * tint.w : 1;
        ctx.drawImage(offscreen, -drawW / 2, -drawH / 2);
        ctx.globalAlpha = 1;
      }
    } else {
      // No tint — draw directly
      ctx.globalAlpha = needsAlpha ? opacity * tint.w : 1;
      ctx.drawImage(img, fr.x, fr.y, fr.w, fr.h, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  // ── Camera Rect ────────────────────────────────────────────
  function drawCameraRect(e) {
    if (!e.camera) return;

    var p = worldToScreen(e.position.x, e.position.y, e.position.z);

    // Camera visible area in isometric space: viewport / (2 * cameraZoom)
    // Scaled by editor zoom to get screen pixels
    var halfW = (e.camera.viewportWidth / (2 * e.camera.zoom)) * cam.zoom;
    var halfH = (e.camera.viewportHeight / (2 * e.camera.zoom)) * cam.zoom;

    var isSelected = (e.id === selectedEntityId);

    ctx.strokeStyle = isSelected ? 'rgba(255, 255, 255, 0.9)' : 'rgba(180, 180, 180, 0.4)';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeRect(p.x - halfW, p.y - halfH, halfW * 2, halfH * 2);
  }

  // ── Render ──────────────────────────────────────────────────
  function render() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;

    drawGrid();
    drawOrigin();

    // Depth-sort entities (furthest first = lowest sum drawn first)
    var sorted = entities.slice().sort(function(a, b) {
      return (a.position.x + a.position.y + a.position.z) - (b.position.x + b.position.y + b.position.z);
    });

    // Draw sprites first (back to front)
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i].sprite) {
        drawSprite(sorted[i]);
      }
    }

    // Draw camera view rects
    for (var k = 0; k < sorted.length; k++) {
      if (sorted[k].camera) {
        drawCameraRect(sorted[k]);
      }
    }

    // Draw gizmo crosshairs on top
    for (var j = 0; j < sorted.length; j++) {
      drawEntity(sorted[j]);
    }
  }

  // ── Mouse Handlers ──────────────────────────────────────────
  canvas.addEventListener('mousedown', function(e) {
    dragging = true;
    dragStart.x = e.clientX;
    dragStart.y = e.clientY;
    camStart.x = cam.panX;
    camStart.y = cam.panY;
    canvas.style.cursor = 'grabbing';
  });

  canvas.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    var dx = e.clientX - dragStart.x;
    var dy = e.clientY - dragStart.y;
    cam.panX = camStart.x - dx / cam.zoom;
    cam.panY = camStart.y + dy / cam.zoom;
    render();
  });

  canvas.addEventListener('mouseup', function() {
    dragging = false;
    canvas.style.cursor = 'default';
  });

  canvas.addEventListener('mouseleave', function() {
    dragging = false;
    canvas.style.cursor = 'default';
  });

  canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    var delta = e.deltaY > 0 ? -0.15 : 0.15;
    cam.zoom = Math.max(0.2, Math.min(10, cam.zoom + delta * cam.zoom));
    render();
  }, { passive: false });

  // ── Message Handler ─────────────────────────────────────────
  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (msg.type === 'scene:data') {
      entities = msg.entities || [];
      sceneName = msg.name || '';
      infoEl.textContent = sceneName
        ? sceneName + ' — ' + entities.length + ' entities'
        : 'Editor Preview';

      // Load texture images
      var texList = msg.textures || [];
      var pending = 0;
      for (var i = 0; i < texList.length; i++) {
        var tex = texList[i];
        if (textures[tex.textureMapKey] && textures[tex.textureMapKey].src === tex.imageData) {
          // Already loaded with same data, just update imageType
          textures[tex.textureMapKey].imageType = tex.imageType;
          continue;
        }
        pending++;
        (function(key, imageType, imageData) {
          var img = new Image();
          img.onload = function() {
            textures[key] = { img: img, imageType: imageType, src: imageData };
            pending--;
            if (pending <= 0) render();
          };
          img.onerror = function() {
            pending--;
            if (pending <= 0) render();
          };
          img.src = imageData;
        })(tex.textureMapKey, tex.imageType, tex.imageData);
      }

      // If no textures to load, render immediately
      if (pending <= 0) render();
    }
    if (msg.type === 'selection:changed') {
      selectedEntityId = msg.selectedId !== undefined ? msg.selectedId : -1;
      render();
    }
  });

  // ── Resize ──────────────────────────────────────────────────
  var resizeTimer;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 50);
  });

  // Initial render
  render();
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
