/**
 * Texture-Map Frame Editor — WebviewPanel for visually configuring
 * frame extraction (GridConfig or FrameMap) on a source image.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { OmosceneEditorProvider } from './omoscene-editor';
import type { InspectorProvider } from '../panels/inspector';
import type { SerializedComponent } from '../types/engine';

/**
 * Serialized imageType format used in .omoscene files.
 */
interface SerializedGridConfig {
  mode: 'grid';
  cellWidth: number;
  cellHeight: number;
  cols: number;
  rows: number;
  cellCount?: number;
}

interface SerializedFrameMapFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SerializedFrameMap {
  mode: 'framemap';
  frames: SerializedFrameMapFrame[];
}

type SerializedImageType = SerializedGridConfig | SerializedFrameMap | null;

let activePanel: vscode.WebviewPanel | null = null;

/**
 * Opens (or focuses) the texture-map frame editor for the given component.
 */
export function openFrameEditor(
  context: vscode.ExtensionContext,
  component: SerializedComponent,
  omosceneEditor: OmosceneEditorProvider,
  inspectorProvider: InspectorProvider
): void {
  // If a panel already exists, focus it and send new data
  if (activePanel) {
    activePanel.reveal(vscode.ViewColumn.One);
    loadComponentIntoPanel(activePanel, component);
    return;
  }

  activePanel = vscode.window.createWebviewPanel(
    'omosuen.frameEditor',
    `Frames: ${component.name}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  // Register message handler BEFORE setting HTML to avoid
  // missing the 'ready' message from the webview script
  activePanel.webview.onDidReceiveMessage(
    (msg: { type: string; imageType?: SerializedImageType }) => {
      if (msg.type === 'ready') {
        loadComponentIntoPanel(activePanel!, component);
      } else if (msg.type === 'imageTypeChanged' && component.id !== undefined) {
        // Update the document
        omosceneEditor.updateComponentProperty(
          component.id,
          'imageType',
          msg.imageType
        );
        // Update the local component reference and refresh the inspector
        (component as Record<string, unknown>).imageType = msg.imageType;
        inspectorProvider.showComponent(component);
      }
    },
    undefined,
    context.subscriptions
  );

  activePanel.webview.html = getFrameEditorHtml(activePanel.webview);

  activePanel.onDidDispose(() => {
    activePanel = null;
  });
}

/**
 * Reads the source image and posts it to the webview along with imageType config.
 */
function loadComponentIntoPanel(
  panel: vscode.WebviewPanel,
  component: SerializedComponent
): void {
  const comp = component as Record<string, unknown>;
  const filePath = (comp.filePath as string) || '';
  const textureMapKey = (comp.textureMapKey as string) || '';
  const imageType = (comp.imageType as SerializedImageType) || null;

  if (!filePath) {
    panel.webview.postMessage({
      type: 'load',
      imageData: null,
      imageType,
      textureMapKey,
    });
    return;
  }

  // Resolve the file path relative to the workspace
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) { return; }

  const projectRoot = workspaceFolders[0].uri.fsPath;
  const absPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(projectRoot, filePath);

  if (!fs.existsSync(absPath)) {
    vscode.window.showWarningMessage(
      `Image file not found: ${filePath}`
    );
    panel.webview.postMessage({
      type: 'load',
      imageData: null,
      imageType,
      textureMapKey,
    });
    return;
  }

  // Read image as base64 data URI
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
  const dataUri = `data:${mime};base64,${base64}`;

  panel.webview.postMessage({
    type: 'load',
    imageData: dataUri,
    imageType,
    textureMapKey,
  });
}

// ── Webview HTML ──────────────────────────────────────────────────

function getFrameEditorHtml(_webview: vscode.Webview): string {
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #1e1e1e; color: #ccc; font-family: var(--vscode-font-family, sans-serif); font-size: 13px; }

  #app { display: flex; flex-direction: column; height: 100%; }

  /* ── Toolbar ──────────────────────────────────────────────── */
  .toolbar {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px; background: #252526; border-bottom: 1px solid #3c3c3c;
    flex-shrink: 0;
  }
  .toolbar label { font-size: 12px; color: #999; }
  .toolbar select, .toolbar button {
    background: #3c3c3c; color: #ccc; border: 1px solid #555; border-radius: 3px;
    padding: 3px 8px; font-size: 12px; cursor: pointer;
  }
  .toolbar select:focus, .toolbar button:focus { outline: 1px solid #007acc; }
  .toolbar button:hover { background: #505050; }
  .toolbar .key-label { color: #9cdcfe; font-weight: bold; margin-left: auto; }

  /* ── Canvas ────────────────────────────────────────────────── */
  .canvas-wrap {
    flex: 1; position: relative; overflow: hidden; background: #1a1a1a;
    background-image:
      linear-gradient(45deg, #222 25%, transparent 25%, transparent 75%, #222 75%),
      linear-gradient(45deg, #222 25%, transparent 25%, transparent 75%, #222 75%);
    background-size: 16px 16px;
    background-position: 0 0, 8px 8px;
  }
  canvas { position: absolute; top: 0; left: 0; image-rendering: pixelated; }

  /* ── Config Panel ──────────────────────────────────────────── */
  .config-panel {
    display: flex; align-items: center; gap: 10px;
    padding: 6px 10px; background: #252526; border-top: 1px solid #3c3c3c;
    flex-shrink: 0; flex-wrap: wrap;
  }
  .config-panel.hidden { display: none; }
  .config-panel label { font-size: 12px; color: #999; }
  .config-panel input[type="number"] {
    width: 56px; background: #3c3c3c; color: #ccc; border: 1px solid #555;
    border-radius: 3px; padding: 2px 4px; font-size: 12px; text-align: center;
  }
  .config-panel input:focus { outline: 1px solid #007acc; }

  /* ── Frame Strip ───────────────────────────────────────────── */
  .frame-strip {
    display: flex; gap: 2px; padding: 6px 10px; background: #252526;
    border-top: 1px solid #3c3c3c; overflow-x: auto; flex-shrink: 0;
    min-height: 64px; align-items: center;
  }
  .frame-strip.hidden { display: none; }
  .frame-thumb {
    flex-shrink: 0; width: 48px; height: 48px; border: 1px solid #555;
    border-radius: 3px; overflow: hidden; position: relative; cursor: pointer;
    background: #1a1a1a;
  }
  .frame-thumb.selected { border-color: #007acc; border-width: 2px; }
  .frame-thumb canvas { width: 100%; height: 100%; }
  .frame-thumb .idx {
    position: absolute; bottom: 1px; right: 2px;
    font-size: 9px; color: rgba(255,255,255,0.6);
  }

  /* ── No Image Message ─────────────────────────────────────── */
  .no-image {
    flex: 1; display: flex; align-items: center; justify-content: center;
    color: #666; font-size: 14px;
  }
</style>
</head>
<body>
<div id="app">
  <!-- Toolbar -->
  <div class="toolbar">
    <label>Mode:</label>
    <select id="mode-select">
      <option value="single">Single Frame</option>
      <option value="grid">Grid</option>
      <option value="framemap">Frame Map</option>
    </select>
    <span class="key-label" id="key-label"></span>
  </div>

  <!-- Canvas -->
  <div class="canvas-wrap" id="canvas-wrap">
    <canvas id="main-canvas"></canvas>
  </div>

  <!-- Grid Config -->
  <div class="config-panel hidden" id="grid-config">
    <label>Cell W:</label><input type="number" id="grid-cw" value="32" min="1">
    <label>Cell H:</label><input type="number" id="grid-ch" value="32" min="1">
    <label>Cols:</label><input type="number" id="grid-cols" value="4" min="1">
    <label>Rows:</label><input type="number" id="grid-rows" value="4" min="1">
    <label>Count:</label><input type="number" id="grid-count" value="" min="0" placeholder="auto">
  </div>

  <!-- FrameMap Config -->
  <div class="config-panel hidden" id="framemap-config">
    <label>Selected:</label>
    <label>X:</label><input type="number" id="fm-x" value="0" min="0">
    <label>Y:</label><input type="number" id="fm-y" value="0" min="0">
    <label>W:</label><input type="number" id="fm-w" value="32" min="1">
    <label>H:</label><input type="number" id="fm-h" value="32" min="1">
    <button id="fm-delete">Delete Frame</button>
  </div>

  <!-- Frame Strip -->
  <div class="frame-strip hidden" id="frame-strip"></div>

  <!-- No image placeholder -->
  <div class="no-image" id="no-image" style="display: none;">No image loaded. Set a filePath on the texture-map component.</div>
</div>

<script nonce="${nonce}">
(function() {
  'use strict';

  var vscode = acquireVsCodeApi();

  // ── DOM refs ──────────────────────────────────────────────
  var modeSelect = document.getElementById('mode-select');
  var canvasWrap = document.getElementById('canvas-wrap');
  var canvas = document.getElementById('main-canvas');
  var ctx = canvas.getContext('2d');
  var gridConfigEl = document.getElementById('grid-config');
  var framemapConfigEl = document.getElementById('framemap-config');
  var frameStripEl = document.getElementById('frame-strip');
  var noImageEl = document.getElementById('no-image');
  var keyLabel = document.getElementById('key-label');

  // Grid inputs
  var gridCW = document.getElementById('grid-cw');
  var gridCH = document.getElementById('grid-ch');
  var gridCols = document.getElementById('grid-cols');
  var gridRows = document.getElementById('grid-rows');
  var gridCount = document.getElementById('grid-count');

  // FrameMap inputs
  var fmX = document.getElementById('fm-x');
  var fmY = document.getElementById('fm-y');
  var fmW = document.getElementById('fm-w');
  var fmH = document.getElementById('fm-h');
  var fmDelete = document.getElementById('fm-delete');

  // ── State ──────────────────────────────────────────────────
  var img = null;           // HTMLImageElement
  var mode = 'single';     // 'single' | 'grid' | 'framemap'
  var cam = { x: 0, y: 0, zoom: 1 };

  // Grid state
  var grid = { cellW: 32, cellH: 32, cols: 4, rows: 4, count: 0 };

  // FrameMap state
  var frames = [];         // [{x,y,w,h}, ...]
  var selectedFrame = -1;

  // Drag state
  var dragging = false;
  var dragType = 'pan';    // 'pan' | 'draw' | 'move' | 'resize'
  var dragStart = { x: 0, y: 0 };
  var dragOrigin = { x: 0, y: 0 };
  var drawRect = null;
  var resizeHandle = '';
  var dragFrameStart = null;

  // ── Coordinate helpers ────────────────────────────────────
  function screenToImage(sx, sy) {
    var rect = canvas.getBoundingClientRect();
    var cx = sx - rect.left;
    var cy = sy - rect.top;
    return {
      x: (cx - cam.x) / cam.zoom,
      y: (cy - cam.y) / cam.zoom,
    };
  }

  function imageToScreen(ix, iy) {
    return {
      x: ix * cam.zoom + cam.x,
      y: iy * cam.zoom + cam.y,
    };
  }

  // ── Rendering ──────────────────────────────────────────────
  function render() {
    var w = canvasWrap.clientWidth;
    var h = canvasWrap.clientHeight;
    canvas.width = w;
    canvas.height = h;

    ctx.clearRect(0, 0, w, h);

    if (!img) return;

    // Disable smoothing for crisp pixel rendering
    ctx.imageSmoothingEnabled = false;

    // Draw image
    var dx = cam.x;
    var dy = cam.y;
    var dw = img.width * cam.zoom;
    var dh = img.height * cam.zoom;
    ctx.drawImage(img, dx, dy, dw, dh);

    // Draw image border
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(dx, dy, dw, dh);

    if (mode === 'grid') {
      drawGridOverlay();
    } else if (mode === 'framemap') {
      drawFrameMapOverlay();
    }

    // Draw in-progress rectangle
    if (drawRect) {
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      var r = rectToScreen(drawRect);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([]);
    }

    updateFrameStrip();
  }

  function drawGridOverlay() {
    if (!img) return;

    ctx.strokeStyle = 'rgba(0, 180, 255, 0.6)';
    ctx.lineWidth = 1;

    var cw = grid.cellW * cam.zoom;
    var ch = grid.cellH * cam.zoom;
    var totalCols = grid.cols;
    var totalRows = grid.rows;
    var maxCount = grid.count > 0 ? grid.count : totalCols * totalRows;

    // Draw grid cells
    var idx = 0;
    for (var row = 0; row < totalRows; row++) {
      for (var col = 0; col < totalCols; col++) {
        if (idx >= maxCount) break;
        var sx = cam.x + col * cw;
        var sy = cam.y + row * ch;
        ctx.strokeRect(sx, sy, cw, ch);

        // Frame index label
        ctx.fillStyle = 'rgba(0, 180, 255, 0.8)';
        ctx.font = Math.min(12, cw * 0.3) + 'px monospace';
        ctx.fillText(String(idx), sx + 3, sy + Math.min(14, ch * 0.4));
        idx++;
      }
    }
  }

  function drawFrameMapOverlay() {
    for (var i = 0; i < frames.length; i++) {
      var f = frames[i];
      var r = rectToScreen(f);
      var isSelected = (i === selectedFrame);

      // Frame rectangle
      ctx.strokeStyle = isSelected ? '#00ff88' : 'rgba(255, 180, 0, 0.7)';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeRect(r.x, r.y, r.w, r.h);

      // Fill with translucent color
      ctx.fillStyle = isSelected ? 'rgba(0, 255, 136, 0.1)' : 'rgba(255, 180, 0, 0.05)';
      ctx.fillRect(r.x, r.y, r.w, r.h);

      // Frame index label
      ctx.fillStyle = isSelected ? '#00ff88' : 'rgba(255, 180, 0, 0.9)';
      ctx.font = '11px monospace';
      ctx.fillText(String(i), r.x + 3, r.y + 13);

      // Resize handles for selected frame
      if (isSelected) {
        drawResizeHandles(r);
      }
    }
  }

  function drawResizeHandles(r) {
    var size = 6;
    var handles = getHandlePositions(r);
    ctx.fillStyle = '#00ff88';
    for (var key in handles) {
      var h = handles[key];
      ctx.fillRect(h.x - size / 2, h.y - size / 2, size, size);
    }
  }

  function getHandlePositions(r) {
    return {
      tl: { x: r.x, y: r.y },
      tr: { x: r.x + r.w, y: r.y },
      bl: { x: r.x, y: r.y + r.h },
      br: { x: r.x + r.w, y: r.y + r.h },
      t:  { x: r.x + r.w / 2, y: r.y },
      b:  { x: r.x + r.w / 2, y: r.y + r.h },
      l:  { x: r.x, y: r.y + r.h / 2 },
      r:  { x: r.x + r.w, y: r.y + r.h / 2 },
    };
  }

  function rectToScreen(rect) {
    var tl = imageToScreen(rect.x, rect.y);
    return {
      x: tl.x,
      y: tl.y,
      w: rect.w * cam.zoom,
      h: rect.h * cam.zoom,
    };
  }

  // ── Frame Strip ────────────────────────────────────────────
  function updateFrameStrip() {
    if (!img) return;

    var frameList = getFrameList();
    frameStripEl.innerHTML = '';

    for (var i = 0; i < frameList.length; i++) {
      var f = frameList[i];
      var thumb = document.createElement('div');
      thumb.className = 'frame-thumb' + (mode === 'framemap' && i === selectedFrame ? ' selected' : '');
      thumb.setAttribute('data-idx', String(i));

      var tc = document.createElement('canvas');
      tc.width = 48;
      tc.height = 48;
      var tctx = tc.getContext('2d');
      tctx.imageSmoothingEnabled = false;

      // Scale frame to fit thumbnail
      var scale = Math.min(46 / f.w, 46 / f.h, 2);
      var dw = f.w * scale;
      var dh = f.h * scale;
      var dx = (48 - dw) / 2;
      var dy = (48 - dh) / 2;
      tctx.drawImage(img, f.x, f.y, f.w, f.h, dx, dy, dw, dh);

      thumb.appendChild(tc);

      var idx = document.createElement('span');
      idx.className = 'idx';
      idx.textContent = String(i);
      thumb.appendChild(idx);

      thumb.addEventListener('click', (function(index) {
        return function() {
          if (mode === 'framemap') {
            selectedFrame = index;
            updateFrameMapInputs();
            render();
          }
        };
      })(i));

      frameStripEl.appendChild(thumb);
    }
  }

  function getFrameList() {
    if (mode === 'grid') {
      var list = [];
      var maxCount = grid.count > 0 ? grid.count : grid.cols * grid.rows;
      var idx = 0;
      for (var row = 0; row < grid.rows; row++) {
        for (var col = 0; col < grid.cols; col++) {
          if (idx >= maxCount) break;
          list.push({
            x: col * grid.cellW,
            y: row * grid.cellH,
            w: grid.cellW,
            h: grid.cellH,
          });
          idx++;
        }
      }
      return list;
    } else if (mode === 'framemap') {
      return frames;
    } else {
      // Single mode — whole image
      if (img) return [{ x: 0, y: 0, w: img.width, h: img.height }];
      return [];
    }
  }

  // ── Mouse Handlers ─────────────────────────────────────────
  canvas.addEventListener('mousedown', function(e) {
    e.preventDefault();
    var imgPos = screenToImage(e.clientX, e.clientY);

    // Middle mouse — always pan
    if (e.button === 1) {
      dragging = true;
      dragType = 'pan';
      dragOrigin = { x: cam.x, y: cam.y };
      dragStart = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = 'grabbing';
      return;
    }

    // Left mouse — framemap interactions only
    if (e.button === 0 && mode === 'framemap') {
      // Check resize handles first
      if (selectedFrame >= 0 && selectedFrame < frames.length) {
        var r = rectToScreen(frames[selectedFrame]);
        var handles = getHandlePositions(r);
        var hitSize = 8;
        for (var key in handles) {
          var h = handles[key];
          var rect = canvas.getBoundingClientRect();
          var mx = e.clientX - rect.left;
          var my = e.clientY - rect.top;
          if (Math.abs(mx - h.x) < hitSize && Math.abs(my - h.y) < hitSize) {
            dragging = true;
            dragType = 'resize';
            resizeHandle = key;
            dragStart = { x: imgPos.x, y: imgPos.y };
            dragFrameStart = Object.assign({}, frames[selectedFrame]);
            return;
          }
        }
      }

      // Check if clicking on existing frame
      for (var i = frames.length - 1; i >= 0; i--) {
        var f = frames[i];
        if (imgPos.x >= f.x && imgPos.x <= f.x + f.w && imgPos.y >= f.y && imgPos.y <= f.y + f.h) {
          selectedFrame = i;
          updateFrameMapInputs();
          dragging = true;
          dragType = 'move';
          dragStart = { x: imgPos.x, y: imgPos.y };
          dragFrameStart = Object.assign({}, frames[i]);
          render();
          return;
        }
      }

      // Start drawing new frame
      if (img && imgPos.x >= 0 && imgPos.y >= 0 && imgPos.x <= img.width && imgPos.y <= img.height) {
        dragging = true;
        dragType = 'draw';
        dragStart = { x: Math.round(imgPos.x), y: Math.round(imgPos.y) };
        drawRect = { x: dragStart.x, y: dragStart.y, w: 0, h: 0 };
        selectedFrame = -1;
        updateFrameMapInputs();
        render();
        return;
      }
    }
  });

  canvas.addEventListener('mousemove', function(e) {
    if (!dragging) {
      // Update cursor for resize handles
      if (mode === 'framemap' && selectedFrame >= 0 && selectedFrame < frames.length) {
        var r = rectToScreen(frames[selectedFrame]);
        var handles = getHandlePositions(r);
        var rect = canvas.getBoundingClientRect();
        var mx = e.clientX - rect.left;
        var my = e.clientY - rect.top;
        var hitSize = 8;
        var cursorMap = {
          tl: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize', br: 'nwse-resize',
          t: 'ns-resize', b: 'ns-resize', l: 'ew-resize', r: 'ew-resize',
        };
        for (var key in handles) {
          var h = handles[key];
          if (Math.abs(mx - h.x) < hitSize && Math.abs(my - h.y) < hitSize) {
            canvas.style.cursor = cursorMap[key];
            return;
          }
        }
        canvas.style.cursor = 'default';
      }
      return;
    }

    var imgPos = screenToImage(e.clientX, e.clientY);

    if (dragType === 'pan') {
      cam.x = dragOrigin.x + (e.clientX - dragStart.x);
      cam.y = dragOrigin.y + (e.clientY - dragStart.y);
      render();
    } else if (dragType === 'draw') {
      var x = Math.min(dragStart.x, Math.round(imgPos.x));
      var y = Math.min(dragStart.y, Math.round(imgPos.y));
      var w = Math.abs(Math.round(imgPos.x) - dragStart.x);
      var h = Math.abs(Math.round(imgPos.y) - dragStart.y);
      drawRect = { x: x, y: y, w: w, h: h };
      render();
    } else if (dragType === 'move' && selectedFrame >= 0) {
      var dx = Math.round(imgPos.x - dragStart.x);
      var dy = Math.round(imgPos.y - dragStart.y);
      frames[selectedFrame].x = dragFrameStart.x + dx;
      frames[selectedFrame].y = dragFrameStart.y + dy;
      updateFrameMapInputs();
      render();
    } else if (dragType === 'resize' && selectedFrame >= 0) {
      applyResize(imgPos);
      updateFrameMapInputs();
      render();
    }
  });

  canvas.addEventListener('mouseup', function() {
    if (dragging && dragType === 'draw' && drawRect && drawRect.w > 2 && drawRect.h > 2) {
      frames.push({ x: drawRect.x, y: drawRect.y, w: drawRect.w, h: drawRect.h });
      selectedFrame = frames.length - 1;
      updateFrameMapInputs();
      emitChange();
    } else if (dragging && (dragType === 'move' || dragType === 'resize')) {
      emitChange();
    }
    dragging = false;
    drawRect = null;
    dragFrameStart = null;
    canvas.style.cursor = 'default';
    render();
  });

  canvas.addEventListener('mouseleave', function() {
    if (dragging && dragType === 'pan') {
      dragging = false;
      canvas.style.cursor = 'default';
    }
  });

  canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;

    var oldZoom = cam.zoom;
    var delta = e.deltaY > 0 ? -0.1 : 0.1;
    cam.zoom = Math.max(0.1, Math.min(20, cam.zoom + delta * cam.zoom));

    // Zoom toward mouse position
    cam.x = mx - (mx - cam.x) * (cam.zoom / oldZoom);
    cam.y = my - (my - cam.y) * (cam.zoom / oldZoom);
    render();
  }, { passive: false });

  // ── Resize Helpers ─────────────────────────────────────────
  function applyResize(imgPos) {
    var f = frames[selectedFrame];
    var s = dragFrameStart;
    var dx = Math.round(imgPos.x - dragStart.x);
    var dy = Math.round(imgPos.y - dragStart.y);

    switch (resizeHandle) {
      case 'br':
        f.w = Math.max(1, s.w + dx);
        f.h = Math.max(1, s.h + dy);
        break;
      case 'tl':
        f.x = s.x + dx; f.y = s.y + dy;
        f.w = Math.max(1, s.w - dx); f.h = Math.max(1, s.h - dy);
        break;
      case 'tr':
        f.y = s.y + dy;
        f.w = Math.max(1, s.w + dx); f.h = Math.max(1, s.h - dy);
        break;
      case 'bl':
        f.x = s.x + dx;
        f.w = Math.max(1, s.w - dx); f.h = Math.max(1, s.h + dy);
        break;
      case 't':
        f.y = s.y + dy; f.h = Math.max(1, s.h - dy);
        break;
      case 'b':
        f.h = Math.max(1, s.h + dy);
        break;
      case 'l':
        f.x = s.x + dx; f.w = Math.max(1, s.w - dx);
        break;
      case 'r':
        f.w = Math.max(1, s.w + dx);
        break;
    }
  }

  // ── Keyboard ──────────────────────────────────────────────
  document.addEventListener('keydown', function(e) {
    if (mode === 'framemap' && e.key === 'Delete' && selectedFrame >= 0) {
      frames.splice(selectedFrame, 1);
      selectedFrame = -1;
      updateFrameMapInputs();
      emitChange();
      render();
    }
  });

  // ── Mode Switch ────────────────────────────────────────────
  modeSelect.addEventListener('change', function() {
    mode = modeSelect.value;
    selectedFrame = -1;
    showConfigForMode();
    emitChange();
    render();
  });

  function showConfigForMode() {
    gridConfigEl.classList.toggle('hidden', mode !== 'grid');
    framemapConfigEl.classList.toggle('hidden', mode !== 'framemap');
    frameStripEl.classList.toggle('hidden', mode === 'single');
  }

  // ── Grid Input Handlers ────────────────────────────────────
  function onGridInput() {
    grid.cellW = parseInt(gridCW.value) || 1;
    grid.cellH = parseInt(gridCH.value) || 1;
    grid.cols = parseInt(gridCols.value) || 1;
    grid.rows = parseInt(gridRows.value) || 1;
    grid.count = parseInt(gridCount.value) || 0;
    emitChange();
    render();
  }
  gridCW.addEventListener('input', onGridInput);
  gridCH.addEventListener('input', onGridInput);
  gridCols.addEventListener('input', onGridInput);
  gridRows.addEventListener('input', onGridInput);
  gridCount.addEventListener('input', onGridInput);

  // ── FrameMap Input Handlers ────────────────────────────────
  function onFrameMapInput() {
    if (selectedFrame < 0 || selectedFrame >= frames.length) return;
    frames[selectedFrame].x = parseInt(fmX.value) || 0;
    frames[selectedFrame].y = parseInt(fmY.value) || 0;
    frames[selectedFrame].w = Math.max(1, parseInt(fmW.value) || 1);
    frames[selectedFrame].h = Math.max(1, parseInt(fmH.value) || 1);
    emitChange();
    render();
  }
  fmX.addEventListener('input', onFrameMapInput);
  fmY.addEventListener('input', onFrameMapInput);
  fmW.addEventListener('input', onFrameMapInput);
  fmH.addEventListener('input', onFrameMapInput);

  fmDelete.addEventListener('click', function() {
    if (selectedFrame >= 0 && selectedFrame < frames.length) {
      frames.splice(selectedFrame, 1);
      selectedFrame = -1;
      updateFrameMapInputs();
      emitChange();
      render();
    }
  });

  function updateFrameMapInputs() {
    if (selectedFrame >= 0 && selectedFrame < frames.length) {
      var f = frames[selectedFrame];
      fmX.value = f.x;
      fmY.value = f.y;
      fmW.value = f.w;
      fmH.value = f.h;
    }
  }

  // ── Emit Change ────────────────────────────────────────────
  function emitChange() {
    var imageType = null;

    if (mode === 'grid') {
      imageType = {
        mode: 'grid',
        cellWidth: grid.cellW,
        cellHeight: grid.cellH,
        cols: grid.cols,
        rows: grid.rows,
        cellCount: grid.count > 0 ? grid.count : undefined,
      };
    } else if (mode === 'framemap') {
      imageType = {
        mode: 'framemap',
        frames: frames.map(function(f) {
          return { x: f.x, y: f.y, w: f.w, h: f.h };
        }),
      };
    }

    vscode.postMessage({ type: 'imageTypeChanged', imageType: imageType });
  }

  // ── Message Handler ────────────────────────────────────────
  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (msg.type === 'load') {
      keyLabel.textContent = msg.textureMapKey || '';

      // Load image
      if (msg.imageData) {
        noImageEl.style.display = 'none';
        canvasWrap.style.display = '';

        var newImg = new Image();
        newImg.onload = function() {
          img = newImg;

          // Center the image in the canvas
          cam.zoom = Math.min(
            (canvasWrap.clientWidth - 40) / img.width,
            (canvasWrap.clientHeight - 40) / img.height,
            2
          );
          cam.x = (canvasWrap.clientWidth - img.width * cam.zoom) / 2;
          cam.y = (canvasWrap.clientHeight - img.height * cam.zoom) / 2;

          // Apply imageType config
          applyImageType(msg.imageType);
          render();
        };
        newImg.src = msg.imageData;
      } else {
        img = null;
        noImageEl.style.display = '';
        canvasWrap.style.display = 'none';
      }
    }
  });

  function applyImageType(imageType) {
    if (!imageType) {
      mode = 'single';
    } else if (imageType.mode === 'grid') {
      mode = 'grid';
      grid.cellW = imageType.cellWidth || 32;
      grid.cellH = imageType.cellHeight || 32;
      grid.cols = imageType.cols || 4;
      grid.rows = imageType.rows || 4;
      grid.count = imageType.cellCount || 0;

      gridCW.value = grid.cellW;
      gridCH.value = grid.cellH;
      gridCols.value = grid.cols;
      gridRows.value = grid.rows;
      gridCount.value = grid.count > 0 ? grid.count : '';
    } else if (imageType.mode === 'framemap') {
      mode = 'framemap';
      frames = (imageType.frames || []).map(function(f) {
        return { x: f.x, y: f.y, w: f.w, h: f.h };
      });
      selectedFrame = -1;
    }

    modeSelect.value = mode;
    showConfigForMode();
  }

  // ── Resize Observer ────────────────────────────────────────
  var resizeTimer;
  new ResizeObserver(function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 30);
  }).observe(canvasWrap);

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
