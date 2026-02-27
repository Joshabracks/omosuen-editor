/**
 * Cell-Map Voxel Editor — WebviewPanel that loads the Omosuen engine
 * for native WebGL2 rendering of the cell map, with overlay UI for editing.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { OmosceneEditorProvider } from './omoscene-editor';
import type { InspectorProvider } from '../panels/inspector';
import { type SerializedComponent, isSerializedNexus } from '../types/engine';
import { httpsDownloadFile } from '../commands/create-project';

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

interface TextureMapInfo {
  key: string;
  fileUri: string;
  imageType: SerializedImageType | null;
}

let activePanel: vscode.WebviewPanel | null = null;

/**
 * Forwards a property change to the cell-map editor webview (no-op if not open).
 */
export function updateCellMapProperty(property: string, value: unknown): void {
  if (!activePanel) return;
  void activePanel.webview.postMessage({ type: 'updateProperty', property, value });
}

/**
 * Opens (or focuses) the voxel map editor for a cell-map component.
 */
export async function openCellMapEditor(
  context: vscode.ExtensionContext,
  component: SerializedComponent,
  omosceneEditor: OmosceneEditorProvider,
  inspectorProvider: InspectorProvider
): Promise<void> {
  // Resolve engine path — download on demand if missing
  let enginePath = resolveEnginePath();

  if (!enginePath) {
    const scene = omosceneEditor.getActiveScene();
    const projectRoot = getProjectRoot();
    if (scene && projectRoot && scene.engine) {
      const editorDir = path.join(projectRoot, '.omosuen_editor');
      fs.mkdirSync(editorDir, { recursive: true });
      const destPath = path.join(editorDir, 'omosuen.min.js');
      const bundleUrl =
        `https://github.com/Joshabracks/omosuen/releases/download/${scene.engine}/omosuen.min.js`;
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Downloading engine bundle...' },
          () => httpsDownloadFile(bundleUrl, destPath)
        );
        enginePath = destPath;
      } catch {
        vscode.window.showErrorMessage(
          'Failed to download engine bundle. Check your internet connection or re-create the project.'
        );
        return;
      }
    } else {
      vscode.window.showErrorMessage(
        'Could not find engine bundle. Open an .omoscene file first.'
      );
      return;
    }
  }

  if (activePanel) {
    activePanel.reveal(vscode.ViewColumn.One);
    loadComponentIntoPanel(activePanel, component, omosceneEditor, enginePath);
    return;
  }

  const engineDir = path.dirname(enginePath);
  const projectRoot = getProjectRoot();

  const localResourceRoots = [
    vscode.Uri.file(engineDir),
  ];
  if (projectRoot) {
    localResourceRoots.push(vscode.Uri.file(projectRoot));
  }

  activePanel = vscode.window.createWebviewPanel(
    'omosuen.cellMapEditor',
    `Map: ${component.name}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots,
    }
  );

  activePanel.webview.onDidReceiveMessage(
    (msg: { type: string; packedData?: number[] }) => {
      if (msg.type === 'ready') {
        loadComponentIntoPanel(activePanel!, component, omosceneEditor, enginePath);
      } else if (msg.type === 'mapChanged' && component.id !== undefined) {
        omosceneEditor.updateComponentProperty(
          component.id,
          'packedData',
          msg.packedData
        );
        (component as Record<string, unknown>).packedData = msg.packedData;
        inspectorProvider.showComponent(component);
      }
    },
    undefined,
    context.subscriptions
  );

  activePanel.webview.html = getCellMapEditorHtml(activePanel.webview, enginePath);

  activePanel.onDidDispose(() => {
    activePanel = null;
  });
}

/**
 * Resolves all resources and posts data to the webview.
 */
function loadComponentIntoPanel(
  panel: vscode.WebviewPanel,
  component: SerializedComponent,
  omosceneEditor: OmosceneEditorProvider,
  enginePath: string
): void {
  const comp = component as Record<string, unknown>;
  const materials = (comp.materials as CellMapMaterial[]) || [];
  const packedData = (comp.packedData as number[]) || [];
  const cellSize = (comp.cellSize as { x: number; y: number; z: number }) || { x: 1, y: 1, z: 1 };
  const mapSize = (comp.mapSize as { x: number; y: number; z: number }) || { x: 1, y: 1, z: 1 };
  const smoothing = (comp.smoothing as number) ?? 0;
  const normalSmoothing = (comp.normalSmoothing as number) ?? 0;
  const componentName = component.name;

  // Collect all texture-map components in the scene and convert to webview URIs
  const textureMaps: TextureMapInfo[] = [];
  const scene = omosceneEditor.getActiveScene();
  if (scene) {
    collectTextureMaps(scene.scene, panel, textureMaps);
  }

  // Send material image data URIs for palette color sampling
  const materialImageDataUris: (string | null)[] = [];
  for (const mat of materials) {
    if (mat.albedoTextureKey && scene) {
      const tm = findTextureMapByKey(scene.scene, mat.albedoTextureKey);
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

  panel.webview.postMessage({
    type: 'load',
    materials,
    materialImageDataUris,
    packedData,
    cellSize,
    mapSize,
    smoothing,
    normalSmoothing,
    textureMaps,
    componentName,
  });
}

// ── Helper Functions ──────────────────────────────────────────────

function resolveEnginePath(): string | null {
  const projectRoot = getProjectRoot();
  if (!projectRoot) { return null; }
  const bundlePath = path.join(projectRoot, '.omosuen_editor', 'omosuen.min.js');
  if (fs.existsSync(bundlePath)) { return bundlePath; }
  return null;
}

function getProjectRoot(): string | null {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) { return null; }
  return workspaceFolders[0].uri.fsPath;
}

function collectTextureMaps(
  component: SerializedComponent,
  panel: vscode.WebviewPanel,
  result: TextureMapInfo[]
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
      result.push({ key, fileUri, imageType });
    }
  }
  if (isSerializedNexus(component)) {
    for (const child of component.components) {
      collectTextureMaps(child, panel, result);
    }
  }
}

function findTextureMapByKey(
  component: SerializedComponent,
  key: string
): Record<string, unknown> | null {
  if (component.type === 'texture-map') {
    const tm = component as Record<string, unknown>;
    if ((tm.textureMapKey as string) === key) { return tm; }
  }
  if (isSerializedNexus(component)) {
    for (const child of component.components) {
      const found = findTextureMapByKey(child, key);
      if (found) { return found; }
    }
  }
  return null;
}

function resolveFilePath(filePath: string): string | null {
  if (path.isAbsolute(filePath)) { return filePath; }
  const projectRoot = getProjectRoot();
  if (!projectRoot) { return null; }
  return path.join(projectRoot, filePath);
}

function loadImageAsDataUri(filePath: string): string | null {
  const absPath = resolveFilePath(filePath);
  if (!absPath || !fs.existsSync(absPath)) { return null; }

  const imageBuffer = fs.readFileSync(absPath);
  const ext = path.extname(absPath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  };
  const mime = mimeMap[ext] || 'image/png';
  const base64 = imageBuffer.toString('base64');
  return `data:${mime};base64,${base64}`;
}

// ── Webview HTML ──────────────────────────────────────────────────

function getCellMapEditorHtml(webview: vscode.Webview, enginePath: string): string {
  const nonce = getNonce();
  const engineUri = webview.asWebviewUri(vscode.Uri.file(enginePath)).toString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${webview.cspSource} data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #0d0a07; color: #c8bfb0; font-family: 'IBM Plex Mono', monospace; font-size: 13px; }

  /* ── Overlay UI (on top of engine canvas) ─────────────── */
  .control-bar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 100;
    display: flex; align-items: center; gap: 10px;
    padding: 6px 10px; background: rgba(21,17,12,0.92); border-bottom: 1px solid #2e2518;
  }
  .control-bar label { font-size: 12px; color: #7a7060; }
  .control-bar button {
    background: #1e1810; color: #c8bfb0; border: 1px solid #2e2518; border-radius: 3px;
    padding: 2px 8px; font-family: 'IBM Plex Mono', monospace; font-size: 13px;
    cursor: pointer; min-width: 24px;
  }
  .control-bar button:hover { background: #271f14; border-color: #d4a843; }
  .control-bar .height-val { color: #d4a843; font-weight: bold; min-width: 24px; text-align: center; }
  .control-bar .info { color: #7a7060; margin-left: auto; font-size: 11px; }
  .control-bar .status { color: #d4a843; font-size: 11px; }

  .palette {
    position: fixed; left: 0; top: 34px; bottom: 0; z-index: 100;
    width: 72px; background: rgba(21,17,12,0.92);
    border-right: 1px solid #2e2518; overflow-y: auto;
    display: flex; flex-direction: column; align-items: center;
    padding: 6px 0; gap: 4px;
  }
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
<!-- Overlay UI -->
<div class="control-bar">
  <label>Brush Height:</label>
  <button id="height-down">-</button>
  <span class="height-val" id="height-val">0</span>
  <button id="height-up">+</button>
  <span class="info" id="cursor-info"></span>
  <span class="status" id="init-status">Loading engine...</span>
</div>
<div class="palette" id="palette"></div>

<!-- Engine script -->
<script src="${engineUri}"></script>

<script nonce="${nonce}">
(function() {
  'use strict';

  var vscode = acquireVsCodeApi();

  // ── DOM refs ──────────────────────────────────────────────
  var paletteEl = document.getElementById('palette');
  var heightVal = document.getElementById('height-val');
  var heightDown = document.getElementById('height-down');
  var heightUp = document.getElementById('height-up');
  var cursorInfo = document.getElementById('cursor-info');
  var initStatus = document.getElementById('init-status');

  // ── State ──────────────────────────────────────────────────
  var materials = [];
  var materialColors = [];
  var brushHeight = 0;
  var selectedMaterial = 0;
  var mapSize = { x: 1, y: 1, z: 1 };
  var cellSize = { x: 1, y: 1, z: 1 };
  var engineReady = false;

  // Engine component references (set after scene creation)
  var cellMap = null;
  var camera = null;
  var cameraTransform = null;
  var viewport = null;

  // Projection constants
  var COS30 = 0.8660254;
  var SIN30 = 0.5;

  // ── Color generation for palette ──────────────────────────
  function generateMaterialColor(index) {
    var hue = (index * 137.508) % 360;
    var c = (1 - Math.abs(2 * 0.45 - 1)) * 0.5;
    var x = c * (1 - Math.abs((hue / 60) % 2 - 1));
    var m = 0.45 - c / 2;
    var r, g, b;
    if (hue < 60) { r = c; g = x; b = 0; }
    else if (hue < 120) { r = x; g = c; b = 0; }
    else if (hue < 180) { r = 0; g = c; b = x; }
    else if (hue < 240) { r = 0; g = x; b = c; }
    else if (hue < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255),
    };
  }

  function extractDominantColor(img) {
    var tc = document.createElement('canvas');
    tc.width = Math.min(img.width, 64);
    tc.height = Math.min(img.height, 64);
    var tctx = tc.getContext('2d');
    tctx.drawImage(img, 0, 0, tc.width, tc.height);
    var data = tctx.getImageData(0, 0, tc.width, tc.height).data;
    var r = 0, g = 0, b = 0, count = 0;
    for (var i = 0; i < data.length; i += 16) {
      if (data[i + 3] > 0) {
        r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
      }
    }
    if (count === 0) return null;
    return { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
  }

  function colorStr(rgb, alpha) {
    return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + (alpha || 1) + ')';
  }

  function lighten(rgb, f) {
    return { r: Math.min(255, Math.round(rgb.r + (255 - rgb.r) * f)), g: Math.min(255, Math.round(rgb.g + (255 - rgb.g) * f)), b: Math.min(255, Math.round(rgb.b + (255 - rgb.b) * f)) };
  }

  function darken(rgb, f) {
    return { r: Math.round(rgb.r * (1 - f)), g: Math.round(rgb.g * (1 - f)), b: Math.round(rgb.b * (1 - f)) };
  }

  // ── Palette ───────────────────────────────────────────────
  function buildPalette() {
    paletteEl.innerHTML = '';
    for (var i = 0; i < materials.length; i++) {
      var item = document.createElement('div');
      item.className = 'palette-item' + (i === selectedMaterial ? ' selected' : '');

      var tc = document.createElement('canvas');
      tc.width = 48; tc.height = 48;
      drawPaletteCube(tc.getContext('2d'), 48, 48, i);
      item.appendChild(tc);

      var idx = document.createElement('span');
      idx.className = 'pal-idx';
      idx.textContent = String(i);
      item.appendChild(idx);

      item.addEventListener('click', (function(index) {
        return function() { selectedMaterial = index; buildPalette(); updateCursorInfo(); };
      })(i));

      paletteEl.appendChild(item);
    }
  }

  function drawPaletteCube(tctx, w, h, matIdx) {
    var color = matIdx < materialColors.length ? materialColors[matIdx] : { r: 128, g: 128, b: 128 };
    var cx = w / 2, cy = h / 2, s = 14;
    var cos30s = COS30 * s, sin30s = SIN30 * s;

    tctx.fillStyle = colorStr(lighten(color, 0.3));
    tctx.beginPath();
    tctx.moveTo(cx, cy - s); tctx.lineTo(cx + cos30s, cy - sin30s);
    tctx.lineTo(cx, cy); tctx.lineTo(cx - cos30s, cy - sin30s);
    tctx.closePath(); tctx.fill();

    tctx.fillStyle = colorStr(darken(color, 0.2));
    tctx.beginPath();
    tctx.moveTo(cx - cos30s, cy - sin30s); tctx.lineTo(cx, cy);
    tctx.lineTo(cx, cy + s); tctx.lineTo(cx - cos30s, cy + sin30s);
    tctx.closePath(); tctx.fill();

    tctx.fillStyle = colorStr(color);
    tctx.beginPath();
    tctx.moveTo(cx + cos30s, cy - sin30s); tctx.lineTo(cx, cy);
    tctx.lineTo(cx, cy + s); tctx.lineTo(cx + cos30s, cy + sin30s);
    tctx.closePath(); tctx.fill();

    tctx.strokeStyle = 'rgba(0,0,0,0.4)'; tctx.lineWidth = 1;
    tctx.beginPath();
    tctx.moveTo(cx, cy - s); tctx.lineTo(cx + cos30s, cy - sin30s);
    tctx.lineTo(cx + cos30s, cy + sin30s); tctx.lineTo(cx, cy + s);
    tctx.lineTo(cx - cos30s, cy + sin30s); tctx.lineTo(cx - cos30s, cy - sin30s);
    tctx.closePath(); tctx.stroke();
  }

  // ── Projection (matches engine vertex shader + FBO pipeline) ──
  function screenToWorld(sx, sy, planeY) {
    var camX = cameraTransform.position.x;
    var camZ = cameraTransform.position.z;
    var zoom = camera.zoom;
    var pixelScale = camera.pixelScale;

    // Snap camera position to match renderer (see snapCameraPosition)
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

    // isoX = COS30 * (wx - wz)
    // isoY = SIN30 * (wx + wz) - planeY
    var adjustedIsoY = isoY + planeY;
    var u = adjustedIsoY / SIN30; // wx + wz
    var v = isoX / COS30;         // wx - wz
    return { x: (u + v) / 2, y: planeY, z: (u - v) / 2 };
  }

  function worldToScreen(wx, wy, wz) {
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

  // ── Hit Detection ─────────────────────────────────────────
  var cursorCell = null;
  var brushTarget = null;

  function updateBrushTarget(sx, sy) {
    // Offset for viewport position (engine may position canvas with offset)
    var canvasEl = viewport.canvas;
    var rect = canvasEl.getBoundingClientRect();
    var mx = sx - rect.left;
    var my = sy - rect.top;

    brushTarget = null;
    cursorCell = null;

    for (var y = brushHeight; y >= 0; y--) {
      var world = screenToWorld(mx, my, y * cellSize.y);
      var cx = Math.floor(world.x / cellSize.x);
      var cz = Math.floor(world.z / cellSize.z);

      if (cx < 0 || cx >= mapSize.x || cz < 0 || cz >= mapSize.z) continue;

      var cellData = cellMap.getCellData(new Omosuen.Vector3D(cx, y, cz));
      if (cellData && cellData.shapeIndex !== 0) {
        cursorCell = { x: cx, y: y, z: cz };

        var center = worldToScreen(
          (cx + 0.5) * cellSize.x,
          (y + 0.5) * cellSize.y,
          (cz + 0.5) * cellSize.z
        );

        if (my < center.y) {
          if (y + 1 < mapSize.y) brushTarget = { x: cx, y: y + 1, z: cz };
        } else if (mx < center.x) {
          if (cz - 1 >= 0) brushTarget = { x: cx, y: y, z: cz - 1 };
        } else {
          if (cx + 1 < mapSize.x) brushTarget = { x: cx + 1, y: y, z: cz };
        }
        return;
      }
    }

    // No cell found — target ground plane
    var groundWorld = screenToWorld(mx, my, 0);
    var gx = Math.floor(groundWorld.x / cellSize.x);
    var gz = Math.floor(groundWorld.z / cellSize.z);
    if (gx >= 0 && gx < mapSize.x && gz >= 0 && gz < mapSize.z) {
      brushTarget = { x: gx, y: 0, z: gz };
    }

    updateCursorInfo();
  }

  function updateCursorInfo() {
    if (brushTarget) {
      cursorInfo.textContent = 'Cell: ' + brushTarget.x + ',' + brushTarget.y + ',' + brushTarget.z +
        ' | Mat: ' + selectedMaterial + ' | Height: ' + brushHeight;
    } else {
      cursorInfo.textContent = 'Height: ' + brushHeight;
    }
  }

  // ── Cell Editing ──────────────────────────────────────────
  function placeCell() {
    if (!brushTarget || !engineReady) return;
    var existing = cellMap.getCellData(
      new Omosuen.Vector3D(brushTarget.x, brushTarget.y, brushTarget.z)
    );
    if (existing.shapeIndex === 0) {
      cellMap.setCellData(
        new Omosuen.Vector3D(brushTarget.x, brushTarget.y, brushTarget.z),
        { materialIndex: selectedMaterial, shapeIndex: 1, emissionIntensity: 0, visible: true }
      );
      emitChange();
    }
  }

  function removeCell() {
    if (!cursorCell || !engineReady) return;
    cellMap.setCellData(
      new Omosuen.Vector3D(cursorCell.x, cursorCell.y, cursorCell.z),
      { materialIndex: 0, shapeIndex: 0, emissionIntensity: 0, visible: true }
    );
    brushTarget = null;
    cursorCell = null;
    emitChange();
  }

  function emitChange() {
    var flat = [];
    cellMap.packedData.forEach(function(val) { flat.push(val); });
    vscode.postMessage({ type: 'mapChanged', packedData: flat });
  }

  // ── Mouse Handlers (on document, filtered by target) ──────
  document.addEventListener('mousedown', function(e) {
    if (!engineReady) return;

    // Ignore clicks on overlay UI
    if (e.target.closest('.control-bar') || e.target.closest('.palette')) return;

    if (e.button === 0) {
      e.preventDefault();
      updateBrushTarget(e.clientX, e.clientY);
      placeCell();
    } else if (e.button === 2) {
      e.preventDefault();
      updateBrushTarget(e.clientX, e.clientY);
      removeCell();
    }
  });

  document.addEventListener('mousemove', function(e) {
    if (!engineReady) return;
    if (e.target.closest('.control-bar') || e.target.closest('.palette')) return;

    // Only update brush target when not panning (middle-click handled by input controller)
    if (e.buttons === 0 || e.buttons === 1) {
      updateBrushTarget(e.clientX, e.clientY);
      updateCursorInfo();
    }
  });

  document.addEventListener('contextmenu', function(e) {
    e.preventDefault();
  });

  // ── Keyboard ──────────────────────────────────────────────
  document.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      brushHeight = Math.min(mapSize.y - 1, brushHeight + 1);
      heightVal.textContent = String(brushHeight);
      updateCursorInfo();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      brushHeight = Math.max(0, brushHeight - 1);
      heightVal.textContent = String(brushHeight);
      updateCursorInfo();
    }
  });

  heightDown.addEventListener('click', function() {
    brushHeight = Math.max(0, brushHeight - 1);
    heightVal.textContent = String(brushHeight);
    updateCursorInfo();
  });

  heightUp.addEventListener('click', function() {
    brushHeight = Math.min(mapSize.y - 1, brushHeight + 1);
    heightVal.textContent = String(brushHeight);
    updateCursorInfo();
  });

  // ── Engine Scene Creation ─────────────────────────────────
  async function createEditorScene(data) {
    initStatus.textContent = 'Initializing engine...';
    Omosuen.init();

    // 1. Root nexus
    var scene = await Omosuen.newComponent('nexus', { name: 'Editor Scene' });

    // 2. Atlas manager
    initStatus.textContent = 'Creating atlas manager...';
    var atlasManager = await Omosuen.newComponent('atlas-manager', {
      name: 'AtlasManager',
      config: { atlasSize: 4096, maxAtlases: 16, padding: 1 },
    }, scene);

    // 3. Texture maps — use webview URIs as file paths
    initStatus.textContent = 'Loading textures...';
    var tmPromises = [];
    for (var i = 0; i < data.textureMaps.length; i++) {
      var tm = data.textureMaps[i];
      if (!tm.fileUri) continue;
      tmPromises.push(Omosuen.newComponent('texture-map', {
        textureMapKey: tm.key,
        name: tm.key,
        filePath: tm.fileUri,
        imageType: tm.imageType || undefined,
        atlasManager: atlasManager,
      }, scene));
    }
    await Promise.all(tmPromises);

    // 4. Viewport (fill webview)
    initStatus.textContent = 'Creating viewport...';
    viewport = await Omosuen.newComponent('viewport', {
      name: 'Editor Viewport',
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: new Omosuen.Vector4D(0.05, 0.04, 0.03, 1.0),
    }, scene);

    // 5. Camera nexus + transform + camera
    initStatus.textContent = 'Creating camera...';
    var cameraNexus = await Omosuen.newComponent('nexus', {
      name: 'Camera Nexus',
    }, scene);

    var mapWorldW = data.mapSize.x * data.cellSize.x;
    var mapWorldD = data.mapSize.z * data.cellSize.z;
    cameraTransform = await Omosuen.newComponent('transform', {
      name: 'Camera Transform',
      position: new Omosuen.Vector3D(-mapWorldW / 2, 0, -mapWorldD / 2),
    }, cameraNexus);

    camera = await Omosuen.newComponent('camera', {
      name: 'Editor Camera',
      viewportRef: 'Editor Viewport',
      zoom: 0.5,
      axonometricAngle: 30,
      pixelScale: 2,
    }, cameraNexus);

    // 6. Cell map — unpack packedData into materialMap/shapeMap
    initStatus.textContent = 'Building cell map...';
    var ms = new Omosuen.Vector3D(data.mapSize.x, data.mapSize.y, data.mapSize.z);
    var materialMap = new Omosuen.Array3D(ms, 0);
    var shapeMap = new Omosuen.Array3D(ms, 0);

    for (var idx = 0; idx < data.packedData.length; idx++) {
      var cell = Omosuen.unpackCell(data.packedData[idx]);
      materialMap.indexSet(idx, cell.materialIndex);
      shapeMap.indexSet(idx, cell.shapeIndex);
    }

    cellMap = await Omosuen.newComponent('cell-map', {
      name: data.componentName,
      materials: data.materials,
      materialMap: materialMap,
      shapeMap: shapeMap,
      cellSize: new Omosuen.Vector3D(data.cellSize.x, data.cellSize.y, data.cellSize.z),
      mapSize: ms,
      smoothing: data.smoothing || 0,
      normalSmoothing: data.normalSmoothing || 0,
    }, scene);

    // 7. Input controller for camera pan/zoom
    initStatus.textContent = 'Setting up controls...';
    var inputController = await Omosuen.newComponent('input-controller', {
      name: 'Editor Input',
      preventDefault: false,
    }, scene);

    // Camera control state
    var isPanning = false;
    var lastMouseX = 0;
    var lastMouseY = 0;
    var PAN_SENSITIVITY = 1.0;
    var ZOOM_ACCEL = 0.003;
    var ZOOM_ENTROPY = 10.75;
    var zoomVelocity = 0;
    var scrollActive = false;

    inputController.onAction('middleMouseDown', function(event) {
      isPanning = true;
      lastMouseX = event.clientX;
      lastMouseY = event.clientY;
    });
    inputController.onAction('middleMouseUp', function() {
      isPanning = false;
    });
    inputController.onAction('mouseMove', function(event) {
      if (!isPanning) return;
      var dx = event.clientX - lastMouseX;
      var dy = event.clientY - lastMouseY;
      lastMouseX = event.clientX;
      lastMouseY = event.clientY;
      var zoom = camera.zoom;
      var zoomSq = zoom * zoom;
      camera.pan(dx * -PAN_SENSITIVITY / zoomSq, dy * -PAN_SENSITIVITY / zoomSq);
    });
    inputController.onAction('mouseWheel', function(event, deltaY) {
      zoomVelocity += -deltaY * ZOOM_ACCEL;
      scrollActive = true;
      camera.setZoomTarget(
        event.clientX - viewport.offsetX,
        event.clientY - viewport.offsetY
      );
    });

    inputController.bindAction({ eventType: 'mousedown', button: 1, action: 'middleMouseDown' });
    inputController.bindAction({ eventType: 'mouseup', button: 1, action: 'middleMouseUp' });
    inputController.bindAction({ eventType: 'mousemove', action: 'mouseMove' });
    inputController.bindAction({ eventType: 'wheel', action: 'mouseWheel' });

    // Zoom velocity update loop
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
          if (Math.abs(zoomVelocity) < 0.0001) {
            zoomVelocity = 0;
            camera.resetZoomTarget();
          }
        }
      }
      scrollActive = false;
      requestAnimationFrame(zoomLoop);
    }
    requestAnimationFrame(zoomLoop);

    // 8. Lights
    initStatus.textContent = 'Creating lights...';
    await Omosuen.newComponent('light', {
      name: 'Ambient',
      lightType: 'ambient',
      color: new Omosuen.Vector3D(1.0, 0.95, 0.8),
      brightness: 0.4,
    }, scene);

    var dirLightNexus = await Omosuen.newComponent('nexus', { name: 'Dir Light Nexus' }, scene);
    await Omosuen.newComponent('light', {
      name: 'Directional',
      lightType: 'directional',
      color: new Omosuen.Vector3D(0.7, 0.85, 1.0),
      brightness: 0.6,
      direction: new Omosuen.Vector3D(0.5, -0.7, 0.3),
    }, dirLightNexus);

    // 9. Register and start
    initStatus.textContent = 'Starting engine...';
    Omosuen.registerScene('editor', scene);
    await Omosuen.switchScene('editor');
    Omosuen.start(60);

    // Poll for initialization completion
    var pollId = setInterval(function() {
      var qLen = Omosuen.getInitQueueLength();
      var qSize = Omosuen.getInitQueueSize();
      if (qLen === -1) {
        var activeScene = Omosuen.getActiveScene();
        if (activeScene) {
          clearInterval(pollId);
          engineReady = true;
          initStatus.textContent = 'Ready';
          setTimeout(function() { initStatus.style.display = 'none'; }, 2000);
        }
      } else {
        var done = qLen - qSize;
        initStatus.textContent = 'Initializing ' + done + '/' + qLen + '...';
      }
    }, 100);
  }

  // ── Resize ────────────────────────────────────────────────
  window.addEventListener('resize', function() {
    if (viewport && camera) {
      viewport.resize(window.innerWidth, window.innerHeight);
    }
  });

  // ── Message Handler ───────────────────────────────────────
  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (msg.type === 'load') {
      materials = msg.materials || [];
      cellSize = msg.cellSize || { x: 1, y: 1, z: 1 };
      mapSize = msg.mapSize || { x: 1, y: 1, z: 1 };

      // Generate material colors for palette
      materialColors = [];
      for (var i = 0; i < materials.length; i++) {
        var dataUri = (msg.materialImageDataUris && msg.materialImageDataUris[i]) || null;
        if (dataUri) {
          (function(index, uri) {
            var img = new Image();
            img.onload = function() {
              var color = extractDominantColor(img);
              if (color) {
                materialColors[index] = color;
                buildPalette();
              }
            };
            img.src = uri;
          })(i, dataUri);
          materialColors.push(generateMaterialColor(i));
        } else {
          materialColors.push(generateMaterialColor(i));
        }
      }

      brushHeight = 0;
      heightVal.textContent = '0';
      selectedMaterial = 0;

      buildPalette();
      updateCursorInfo();

      // Create engine scene
      createEditorScene(msg).catch(function(err) {
        initStatus.textContent = 'Error: ' + err.message;
        console.error('[CellMap Editor] Scene creation failed:', err);
      });
    } else if (msg.type === 'updateProperty' && engineReady && cellMap) {
      if (msg.property === 'smoothing') {
        cellMap.smoothing = msg.value;
        for (var ci = 0; ci < cellMap.chunks.length; ci++) {
          cellMap.chunks[ci].dirty = true;
        }
      } else if (msg.property === 'normalSmoothing') {
        cellMap.normalSmoothing = msg.value;
        for (var ci = 0; ci < cellMap.chunks.length; ci++) {
          cellMap.chunks[ci].dirty = true;
        }
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
