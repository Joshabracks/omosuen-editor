"use strict";
/**
 * Cell-Map Materials Editor — WebviewPanel for managing cell-map material definitions.
 * Each material maps 4 texture channels (albedo, normal, emission, material) to scene texture-map keys.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.openCellMapMaterialsEditor = openCellMapMaterialsEditor;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const engine_1 = require("../types/engine");
let activePanel = null;
/**
 * Opens (or focuses) the materials editor for a cell-map component.
 */
function openCellMapMaterialsEditor(context, component, omosceneEditor, inspectorProvider) {
    if (activePanel) {
        activePanel.reveal(vscode.ViewColumn.One);
        loadComponentIntoPanel(activePanel, component, omosceneEditor);
        return;
    }
    activePanel = vscode.window.createWebviewPanel('omosuen.cellMapMaterials', `Materials: ${component.name}`, vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true,
    });
    activePanel.webview.onDidReceiveMessage((msg) => {
        if (msg.type === 'ready') {
            loadComponentIntoPanel(activePanel, component, omosceneEditor);
        }
        else if (msg.type === 'materialsChanged' && component.id !== undefined) {
            omosceneEditor.updateComponentProperty(component.id, 'materials', msg.materials);
            component.materials = msg.materials;
            inspectorProvider.showComponent(component);
        }
    }, undefined, context.subscriptions);
    activePanel.webview.html = getMaterialsEditorHtml();
    activePanel.onDidDispose(() => {
        activePanel = null;
    });
}
/**
 * Collects all texture-map components in the scene and posts data to webview.
 */
function loadComponentIntoPanel(panel, component, omosceneEditor) {
    const comp = component;
    const materials = comp.materials || [];
    const componentName = component.name;
    // Collect all texture-map components in the scene
    const availableTextureMaps = [];
    const scene = omosceneEditor.getActiveScene();
    if (scene) {
        collectTextureMaps(scene.scene, availableTextureMaps);
    }
    panel.webview.postMessage({
        type: 'load',
        materials,
        availableTextureMaps,
        componentName,
    });
}
function collectTextureMaps(component, result) {
    if (component.type === 'texture-map') {
        const tm = component;
        const key = tm.textureMapKey || '';
        if (key) {
            const filePath = tm.filePath || '';
            const imageDataUri = filePath ? loadImageAsDataUri(filePath) : null;
            const imageType = tm.imageType || null;
            result.push({ key, imageDataUri, imageType });
        }
    }
    if ((0, engine_1.isSerializedNexus)(component)) {
        for (const child of component.components) {
            collectTextureMaps(child, result);
        }
    }
}
function loadImageAsDataUri(filePath) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return null;
    }
    const projectRoot = workspaceFolders[0].uri.fsPath;
    const absPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(projectRoot, filePath);
    if (!fs.existsSync(absPath)) {
        return null;
    }
    const imageBuffer = fs.readFileSync(absPath);
    const ext = path.extname(absPath).toLowerCase();
    const mimeMap = {
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
function getMaterialsEditorHtml() {
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
  html, body { width: 100%; height: 100%; overflow: hidden; background: #0d0a07; color: #c8bfb0; font-family: 'IBM Plex Mono', monospace; font-size: 13px; }

  #app { display: flex; flex-direction: column; height: 100%; }

  /* ── Control Bar ─────────────────────────────────────────── */
  .control-bar {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px; background: #15110c; border-bottom: 1px solid #2e2518;
    flex-shrink: 0; flex-wrap: wrap;
  }
  .control-bar label { font-size: 12px; color: #7a7060; }
  .control-bar select {
    background: #1e1810; color: #c8bfb0; border: 1px solid #2e2518; border-radius: 3px;
    padding: 3px 6px; font-family: 'IBM Plex Mono', monospace; font-size: 12px; cursor: pointer;
    max-width: 180px;
  }
  .control-bar select:focus { outline: 1px solid #d4a843; }
  .channel-group { display: flex; align-items: center; gap: 4px; }
  .channel-group.active label { color: #d4a843; }
  .frame-badge {
    font-size: 10px; color: #7a7060; background: #1e1810; border: 1px solid #2e2518;
    border-radius: 2px; padding: 1px 4px; min-width: 18px; text-align: center;
  }

  /* ── Main Area ─────────────────────────────────────────── */
  .main-area { display: flex; flex: 1; overflow: hidden; }

  /* ── Material List ─────────────────────────────────────── */
  .material-list {
    width: 160px; min-width: 120px; background: #15110c;
    border-right: 1px solid #2e2518; display: flex; flex-direction: column;
    overflow-y: auto;
  }
  .mat-item {
    padding: 6px 10px; cursor: pointer; border-bottom: 1px solid #1e1810;
    font-size: 12px; display: flex; align-items: center; gap: 6px;
  }
  .mat-item:hover { background: #1e1810; }
  .mat-item.selected { background: #271f14; border-left: 3px solid #d4a843; }
  .mat-idx { color: #7a7060; font-size: 11px; min-width: 24px; }
  .mat-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mat-delete {
    background: none; border: none; color: #7a7060; cursor: pointer; font-size: 14px;
    padding: 0 2px; line-height: 1;
  }
  .mat-delete:hover { color: #c45a8a; }

  .mat-actions {
    padding: 6px 10px; border-top: 1px solid #2e2518;
  }
  .mat-actions button {
    background: #1e1810; color: #c8bfb0; border: 1px solid #2e2518; border-radius: 3px;
    padding: 4px 10px; font-family: 'IBM Plex Mono', monospace; font-size: 12px;
    cursor: pointer; width: 100%;
  }
  .mat-actions button:hover { background: #271f14; border-color: #d4a843; }

  /* ── Preview Area ──────────────────────────────────────── */
  .preview-area {
    flex: 1; position: relative; overflow: hidden; background: #0d0a07;
    background-image:
      linear-gradient(45deg, #181410 25%, transparent 25%, transparent 75%, #181410 75%),
      linear-gradient(45deg, #181410 25%, transparent 25%, transparent 75%, #181410 75%);
    background-size: 16px 16px;
    background-position: 0 0, 8px 8px;
  }
  .preview-area canvas { position: absolute; top: 0; left: 0; image-rendering: pixelated; }
  .preview-area .no-preview {
    color: #7a7060; font-size: 13px;
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  }

  /* ── Info Bar ──────────────────────────────────────────── */
  .info-bar {
    padding: 4px 10px; background: #15110c; border-top: 1px solid #2e2518;
    font-size: 11px; color: #7a7060; flex-shrink: 0;
  }
</style>
</head>
<body>
<div id="app">
  <div class="control-bar" id="control-bar"></div>
  <div class="main-area">
    <div class="material-list" id="material-list"></div>
    <div class="preview-area" id="preview-area">
      <canvas id="preview-canvas"></canvas>
      <div class="no-preview" id="no-preview">Select a material to preview textures</div>
    </div>
  </div>
  <div class="info-bar" id="info-bar"></div>
</div>

<script nonce="${nonce}">
(function() {
  'use strict';

  var vscode = acquireVsCodeApi();

  var controlBar = document.getElementById('control-bar');
  var materialListEl = document.getElementById('material-list');
  var previewArea = document.getElementById('preview-area');
  var previewCanvas = document.getElementById('preview-canvas');
  var previewCtx = previewCanvas.getContext('2d');
  var noPreview = document.getElementById('no-preview');
  var infoBar = document.getElementById('info-bar');

  var materials = [];
  var availableTextureMaps = [];
  var selectedMat = -1;
  var previewKey = '';
  var loadedImages = {};
  var channels = ['albedo', 'normal', 'emission', 'material'];
  var channelKeys = ['albedoTextureKey', 'normalTextureKey', 'emissionTextureKey', 'materialTextureKey'];
  var channelFrameKeys = ['albedoFrame', 'normalFrame', 'emissionFrame', 'materialFrame'];
  var activeChannel = 0;

  // Zoom/pan state for preview
  var cam = { panX: 0, panY: 0, zoom: 1 };
  var dragging = false;
  var dragStart = { x: 0, y: 0 };
  var dragOrigin = { x: 0, y: 0 };

  // ── Message Handler ─────────────────────────────────────
  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (msg.type === 'load') {
      materials = msg.materials || [];
      availableTextureMaps = msg.availableTextureMaps || [];
      loadedImages = {};

      // Ensure frame fields exist on all materials
      for (var mi = 0; mi < materials.length; mi++) {
        if (materials[mi].albedoFrame === undefined) materials[mi].albedoFrame = 0;
        if (materials[mi].normalFrame === undefined) materials[mi].normalFrame = 0;
        if (materials[mi].emissionFrame === undefined) materials[mi].emissionFrame = 0;
        if (materials[mi].materialFrame === undefined) materials[mi].materialFrame = 0;
      }

      // Pre-load all texture map images
      for (var i = 0; i < availableTextureMaps.length; i++) {
        var tm = availableTextureMaps[i];
        if (tm.imageDataUri) {
          var img = new Image();
          img.src = tm.imageDataUri;
          loadedImages[tm.key] = { img: img, imageType: tm.imageType };
        }
      }

      selectedMat = materials.length > 0 ? 0 : -1;
      activeChannel = 0;
      buildControlBar();
      renderMaterialList();
      resetPreviewCamera();
      renderPreview();
      updateInfoBar();
    }
  });

  // ── Control Bar (channel dropdowns) ──────────────────────
  function buildControlBar() {
    controlBar.innerHTML = '';
    for (var c = 0; c < channels.length; c++) {
      var group = document.createElement('div');
      group.className = 'channel-group' + (c === activeChannel ? ' active' : '');
      group.setAttribute('data-channel', String(c));

      var lbl = document.createElement('label');
      lbl.textContent = channels[c].charAt(0).toUpperCase() + channels[c].slice(1) + ':';
      group.appendChild(lbl);

      var sel = document.createElement('select');
      sel.setAttribute('data-channel', String(c));

      var noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = '(none)';
      sel.appendChild(noneOpt);

      for (var t = 0; t < availableTextureMaps.length; t++) {
        var opt = document.createElement('option');
        opt.value = availableTextureMaps[t].key;
        opt.textContent = availableTextureMaps[t].key;
        sel.appendChild(opt);
      }

      sel.addEventListener('change', (function(chIdx) {
        return function(e) {
          if (selectedMat < 0 || selectedMat >= materials.length) return;
          materials[selectedMat][channelKeys[chIdx]] = e.target.value;
          materials[selectedMat][channelFrameKeys[chIdx]] = 0;
          emitChange();
          renderMaterialList();
          resetPreviewCamera();
          renderPreview();
          updateInfoBar();
          updateFrameBadges();
        };
      })(c));

      sel.addEventListener('focus', (function(chIdx) {
        return function() {
          activeChannel = chIdx;
          highlightActiveChannel();
          renderPreview();
        };
      })(c));

      // Hover preview on option focus
      sel.addEventListener('mouseover', function(e) {
        if (e.target.tagName === 'OPTION' && e.target.value) {
          previewKey = e.target.value;
          renderPreview();
        }
      });

      group.appendChild(sel);

      // Frame badge
      var badge = document.createElement('span');
      badge.className = 'frame-badge';
      badge.setAttribute('data-channel-badge', String(c));
      badge.textContent = '0';
      group.appendChild(badge);

      controlBar.appendChild(group);
    }
    updateDropdowns();
    updateFrameBadges();
  }

  function highlightActiveChannel() {
    var groups = controlBar.querySelectorAll('.channel-group');
    for (var i = 0; i < groups.length; i++) {
      var chIdx = parseInt(groups[i].getAttribute('data-channel'));
      if (chIdx === activeChannel) {
        groups[i].classList.add('active');
      } else {
        groups[i].classList.remove('active');
      }
    }
  }

  function updateDropdowns() {
    var selects = controlBar.querySelectorAll('select');
    for (var i = 0; i < selects.length; i++) {
      var chIdx = parseInt(selects[i].getAttribute('data-channel'));
      var val = '';
      if (selectedMat >= 0 && selectedMat < materials.length) {
        val = materials[selectedMat][channelKeys[chIdx]] || '';
      }
      selects[i].value = val;
    }
  }

  function updateFrameBadges() {
    var badges = controlBar.querySelectorAll('.frame-badge');
    for (var i = 0; i < badges.length; i++) {
      var chIdx = parseInt(badges[i].getAttribute('data-channel-badge'));
      var frameVal = 0;
      if (selectedMat >= 0 && selectedMat < materials.length) {
        frameVal = materials[selectedMat][channelFrameKeys[chIdx]] || 0;
      }
      badges[i].textContent = String(frameVal);
    }
  }

  // ── Material List ───────────────────────────────────────
  function renderMaterialList() {
    var scrollTop = materialListEl.scrollTop;
    var items = materialListEl.querySelectorAll('.mat-item');
    for (var r = 0; r < items.length; r++) items[r].remove();
    var actionsEl = materialListEl.querySelector('.mat-actions');
    if (actionsEl) actionsEl.remove();

    for (var i = 0; i < materials.length; i++) {
      var item = document.createElement('div');
      item.className = 'mat-item' + (i === selectedMat ? ' selected' : '');
      item.setAttribute('data-idx', String(i));

      var idx = document.createElement('span');
      idx.className = 'mat-idx';
      idx.textContent = '[' + i + ']';
      item.appendChild(idx);

      var label = document.createElement('span');
      label.className = 'mat-label';
      var albedoKey = materials[i].albedoTextureKey || '';
      label.textContent = albedoKey || '(empty)';
      label.style.color = albedoKey ? '#c8bfb0' : '#7a7060';
      item.appendChild(label);

      if (materials.length > 1) {
        var delBtn = document.createElement('button');
        delBtn.className = 'mat-delete';
        delBtn.textContent = '\\u00d7';
        delBtn.title = 'Delete material';
        delBtn.addEventListener('click', (function(index) {
          return function(e) {
            e.stopPropagation();
            materials.splice(index, 1);
            if (selectedMat >= materials.length) selectedMat = materials.length - 1;
            emitChange();
            renderMaterialList();
            updateDropdowns();
            updateFrameBadges();
            renderPreview();
            updateInfoBar();
          };
        })(i));
        item.appendChild(delBtn);
      }

      item.addEventListener('click', (function(index) {
        return function() {
          selectedMat = index;
          previewKey = '';
          renderMaterialList();
          updateDropdowns();
          updateFrameBadges();
          resetPreviewCamera();
          renderPreview();
          updateInfoBar();
        };
      })(i));

      materialListEl.appendChild(item);
    }

    var actions = document.createElement('div');
    actions.className = 'mat-actions';
    var addBtn = document.createElement('button');
    addBtn.textContent = '+ Add Material';
    addBtn.addEventListener('click', function() {
      materials.push({
        albedoTextureKey: '',
        normalTextureKey: '',
        emissionTextureKey: '',
        materialTextureKey: '',
        albedoFrame: 0,
        normalFrame: 0,
        emissionFrame: 0,
        materialFrame: 0,
      });
      selectedMat = materials.length - 1;
      emitChange();
      renderMaterialList();
      updateDropdowns();
      updateFrameBadges();
      renderPreview();
      updateInfoBar();
    });
    actions.appendChild(addBtn);
    materialListEl.appendChild(actions);

    materialListEl.scrollTop = scrollTop;
  }

  // ── Preview (zoom/pan aware) ────────────────────────────
  function resetPreviewCamera() {
    var key = getActivePreviewKey();
    if (!key || !loadedImages[key]) {
      cam = { panX: 0, panY: 0, zoom: 1 };
      return;
    }
    var entry = loadedImages[key];
    var img = entry.img;
    if (!img.complete) { cam = { panX: 0, panY: 0, zoom: 1 }; return; }
    var areaW = previewArea.clientWidth;
    var areaH = previewArea.clientHeight;
    var fitZoom = Math.min(areaW / img.width, areaH / img.height, 8);
    cam = { panX: 0, panY: 0, zoom: fitZoom };
  }

  function getActivePreviewKey() {
    if (previewKey) return previewKey;
    if (selectedMat >= 0 && selectedMat < materials.length) {
      return materials[selectedMat][channelKeys[activeChannel]] || '';
    }
    return '';
  }

  function renderPreview() {
    var key = getActivePreviewKey();

    if (!key || !loadedImages[key]) {
      previewCanvas.style.display = 'none';
      noPreview.style.display = '';
      return;
    }

    noPreview.style.display = 'none';
    previewCanvas.style.display = '';

    var entry = loadedImages[key];
    var img = entry.img;
    if (!img.complete) {
      img.onload = function() { resetPreviewCamera(); renderPreview(); };
      return;
    }

    var areaW = previewArea.clientWidth;
    var areaH = previewArea.clientHeight;
    previewCanvas.width = areaW;
    previewCanvas.height = areaH;

    previewCtx.imageSmoothingEnabled = false;
    previewCtx.clearRect(0, 0, areaW, areaH);

    // Compute image position with zoom/pan
    var imgW = img.width * cam.zoom;
    var imgH = img.height * cam.zoom;
    var ox = (areaW - imgW) / 2 + cam.panX;
    var oy = (areaH - imgH) / 2 + cam.panY;

    previewCtx.drawImage(img, ox, oy, imgW, imgH);

    // Draw frame overlays
    var it = entry.imageType;
    if (it) {
      drawFrameOverlays(it, img.width, img.height, cam.zoom, ox, oy);
    }
  }

  function drawFrameOverlays(imageType, imgW, imgH, scale, ox, oy) {
    var selectedFrame = -1;
    if (selectedMat >= 0 && selectedMat < materials.length) {
      selectedFrame = materials[selectedMat][channelFrameKeys[activeChannel]] || 0;
    }

    if (imageType.mode === 'grid') {
      var cw = (imageType.cellWidth || 32) * scale;
      var ch = (imageType.cellHeight || 32) * scale;
      var cols = imageType.cols || 1;
      var rows = imageType.rows || 1;
      var maxCount = imageType.cellCount || cols * rows;
      var idx = 0;

      for (var row = 0; row < rows; row++) {
        for (var col = 0; col < cols; col++) {
          if (idx >= maxCount) break;
          var fx = ox + col * cw;
          var fy = oy + row * ch;

          if (idx === selectedFrame) {
            previewCtx.fillStyle = 'rgba(212, 168, 67, 0.25)';
            previewCtx.fillRect(fx, fy, cw, ch);
            previewCtx.strokeStyle = '#d4a843';
            previewCtx.lineWidth = 2;
          } else {
            previewCtx.strokeStyle = 'rgba(74, 157, 187, 0.6)';
            previewCtx.lineWidth = 1;
          }
          previewCtx.strokeRect(fx, fy, cw, ch);

          previewCtx.fillStyle = idx === selectedFrame ? '#d4a843' : 'rgba(212, 168, 67, 0.8)';
          var fontSize = Math.max(8, Math.min(14, cw * 0.2));
          previewCtx.font = fontSize + "px 'IBM Plex Mono', monospace";
          previewCtx.fillText(String(idx), fx + 2, fy + fontSize + 1);
          idx++;
        }
      }
    } else if (imageType.mode === 'framemap' && imageType.frames) {
      for (var i = 0; i < imageType.frames.length; i++) {
        var f = imageType.frames[i];
        var sx = ox + f.x * scale;
        var sy = oy + f.y * scale;
        var sw = f.w * scale;
        var sh = f.h * scale;

        if (i === selectedFrame) {
          previewCtx.fillStyle = 'rgba(212, 168, 67, 0.25)';
          previewCtx.fillRect(sx, sy, sw, sh);
          previewCtx.strokeStyle = '#d4a843';
          previewCtx.lineWidth = 2;
        } else {
          previewCtx.strokeStyle = 'rgba(212, 168, 67, 0.6)';
          previewCtx.lineWidth = 1;
        }
        previewCtx.strokeRect(sx, sy, sw, sh);

        previewCtx.fillStyle = i === selectedFrame ? '#d4a843' : 'rgba(212, 168, 67, 0.8)';
        var fs2 = Math.max(8, Math.min(14, sw * 0.2));
        previewCtx.font = fs2 + "px 'IBM Plex Mono', monospace";
        previewCtx.fillText(String(i), sx + 2, sy + fs2 + 1);
      }
    }
  }

  // ── Frame hit detection ─────────────────────────────────
  function getFrameAtPixel(px, py, key) {
    if (!key || !loadedImages[key]) return -1;
    var entry = loadedImages[key];
    var img = entry.img;
    if (!img.complete || !entry.imageType) return -1;

    var areaW = previewArea.clientWidth;
    var areaH = previewArea.clientHeight;
    var imgW = img.width * cam.zoom;
    var imgH = img.height * cam.zoom;
    var ox = (areaW - imgW) / 2 + cam.panX;
    var oy = (areaH - imgH) / 2 + cam.panY;

    // Convert pixel to image coordinates
    var imgX = (px - ox) / cam.zoom;
    var imgY = (py - oy) / cam.zoom;

    if (imgX < 0 || imgX >= img.width || imgY < 0 || imgY >= img.height) return -1;

    var it = entry.imageType;
    if (it.mode === 'grid') {
      var cw = it.cellWidth || 32;
      var ch = it.cellHeight || 32;
      var cols = it.cols || 1;
      var rows = it.rows || 1;
      var maxCount = it.cellCount || cols * rows;
      var col = Math.floor(imgX / cw);
      var row = Math.floor(imgY / ch);
      if (col < 0 || col >= cols || row < 0 || row >= rows) return -1;
      var idx = row * cols + col;
      return idx < maxCount ? idx : -1;
    } else if (it.mode === 'framemap' && it.frames) {
      for (var i = 0; i < it.frames.length; i++) {
        var f = it.frames[i];
        if (imgX >= f.x && imgX < f.x + f.w && imgY >= f.y && imgY < f.y + f.h) {
          return i;
        }
      }
    }
    return -1;
  }

  // ── Preview mouse handlers ──────────────────────────────
  previewCanvas.addEventListener('mousedown', function(e) {
    e.preventDefault();
    if (e.button === 1) {
      // Middle click — pan
      dragging = true;
      dragStart = { x: e.clientX, y: e.clientY };
      dragOrigin = { x: cam.panX, y: cam.panY };
      previewCanvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button === 0) {
      // Left click — select frame
      var rect = previewCanvas.getBoundingClientRect();
      var px = e.clientX - rect.left;
      var py = e.clientY - rect.top;
      var key = getActivePreviewKey();
      var frame = getFrameAtPixel(px, py, key);
      if (frame >= 0 && selectedMat >= 0 && selectedMat < materials.length) {
        materials[selectedMat][channelFrameKeys[activeChannel]] = frame;
        emitChange();
        updateFrameBadges();
        renderPreview();
        updateInfoBar();
      }
    }
  });

  previewCanvas.addEventListener('mousemove', function(e) {
    if (dragging) {
      cam.panX = dragOrigin.x + (e.clientX - dragStart.x);
      cam.panY = dragOrigin.y + (e.clientY - dragStart.y);
      renderPreview();
      return;
    }
  });

  previewCanvas.addEventListener('mouseup', function() {
    dragging = false;
    previewCanvas.style.cursor = 'default';
  });

  previewCanvas.addEventListener('mouseleave', function() {
    if (dragging) {
      dragging = false;
      previewCanvas.style.cursor = 'default';
    }
  });

  previewCanvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    var rect = previewCanvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    var areaW = previewArea.clientWidth;
    var areaH = previewArea.clientHeight;

    // Zoom toward cursor
    var oldZoom = cam.zoom;
    var factor = e.deltaY > 0 ? 0.85 : 1.18;
    cam.zoom = Math.max(0.25, Math.min(64, cam.zoom * factor));
    var ratio = cam.zoom / oldZoom;

    // Adjust pan to zoom toward cursor
    var cx = mx - areaW / 2;
    var cy = my - areaH / 2;
    cam.panX = cx - ratio * (cx - cam.panX);
    cam.panY = cy - ratio * (cy - cam.panY);

    renderPreview();
  }, { passive: false });

  previewCanvas.addEventListener('contextmenu', function(e) { e.preventDefault(); });

  // ── Info Bar ─────────────────────────────────────────────
  function updateInfoBar() {
    if (selectedMat < 0 || selectedMat >= materials.length) {
      infoBar.textContent = materials.length + ' materials';
      return;
    }
    var m = materials[selectedMat];
    var parts = [];
    for (var c = 0; c < channels.length; c++) {
      var key = m[channelKeys[c]];
      if (key) {
        var frame = m[channelFrameKeys[c]] || 0;
        parts.push(channels[c] + '=' + key + ':' + frame);
      }
    }
    infoBar.textContent = parts.length > 0 ? parts.join(' | ') : '(no keys set)';
  }

  // ── Emit Change ──────────────────────────────────────────
  function emitChange() {
    vscode.postMessage({
      type: 'materialsChanged',
      materials: materials.map(function(m) {
        return {
          albedoTextureKey: m.albedoTextureKey || '',
          normalTextureKey: m.normalTextureKey || '',
          emissionTextureKey: m.emissionTextureKey || '',
          materialTextureKey: m.materialTextureKey || '',
          albedoFrame: m.albedoFrame || 0,
          normalFrame: m.normalFrame || 0,
          emissionFrame: m.emissionFrame || 0,
          materialFrame: m.materialFrame || 0,
        };
      }),
    });
  }

  // Resize handler
  var resizeTimer;
  new ResizeObserver(function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderPreview, 30);
  }).observe(previewArea);

  // Signal ready
  vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
}
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
//# sourceMappingURL=cellmap-materials-editor.js.map