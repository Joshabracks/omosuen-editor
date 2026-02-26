/**
 * Animation Editor — WebviewPanel for visually building sprite animations.
 * Follows the same pattern as texture-map-editor.ts.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { OmosceneEditorProvider } from './omoscene-editor';
import { findParentNexus } from './omoscene-editor';
import type { InspectorProvider } from '../panels/inspector';
import { type SerializedComponent, isSerializedNexus } from '../types/engine';

interface SerializedAnimation {
  name: string;
  frames: number[];
  frameRate: number;
  loop: boolean;
  onComplete?: string;
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

let activePanel: vscode.WebviewPanel | null = null;

/**
 * Opens (or focuses) the animation editor for the given animation-controller component.
 */
export function openAnimationEditor(
  context: vscode.ExtensionContext,
  component: SerializedComponent,
  omosceneEditor: OmosceneEditorProvider,
  inspectorProvider: InspectorProvider
): void {
  if (activePanel) {
    activePanel.reveal(vscode.ViewColumn.One);
    loadComponentIntoPanel(activePanel, component, omosceneEditor);
    return;
  }

  activePanel = vscode.window.createWebviewPanel(
    'omosuen.animationEditor',
    `Animations: ${component.name}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  activePanel.webview.onDidReceiveMessage(
    (msg: { type: string; animations?: SerializedAnimation[] }) => {
      if (msg.type === 'ready') {
        loadComponentIntoPanel(activePanel!, component, omosceneEditor);
      } else if (msg.type === 'animationsChanged' && component.id !== undefined) {
        omosceneEditor.updateComponentProperty(
          component.id,
          'animations',
          msg.animations
        );
        (component as Record<string, unknown>).animations = msg.animations;
        inspectorProvider.showComponent(component);
      }
    },
    undefined,
    context.subscriptions
  );

  activePanel.webview.html = getAnimationEditorHtml();

  activePanel.onDidDispose(() => {
    activePanel = null;
  });
}

/**
 * Resolves the sibling sprite's texture map image and posts all data to the webview.
 */
function loadComponentIntoPanel(
  panel: vscode.WebviewPanel,
  component: SerializedComponent,
  omosceneEditor: OmosceneEditorProvider
): void {
  const comp = component as Record<string, unknown>;
  const animations = (comp.animations as SerializedAnimation[]) || [];
  const componentName = component.name;

  // Resolve the sibling sprite's texture map image
  let imageData: string | null = null;
  let imageType: SerializedImageType | null = null;

  const scene = omosceneEditor.getActiveScene();
  if (scene && component.id !== undefined) {
    const parent = findParentNexus(scene.scene, component.id);
    if (parent && isSerializedNexus(parent)) {
      // Find sibling sprite
      const sprite = parent.components.find((c) => c.type === 'sprite') as Record<string, unknown> | undefined;
      if (sprite) {
        const tmKeys = sprite.textureMapKeys as Record<string, string> | undefined;
        const albedoKey = tmKeys?.albedo;
        if (albedoKey) {
          // Find matching texture-map in scene
          const tm = findTextureMapByKey(scene.scene, albedoKey);
          if (tm) {
            imageType = (tm.imageType as SerializedImageType) || null;
            const filePath = (tm.filePath as string) || '';
            if (filePath) {
              imageData = loadImageAsDataUri(filePath);
            }
          }
        }
      }
    }
  }

  panel.webview.postMessage({
    type: 'load',
    imageData,
    imageType,
    animations,
    componentName,
  });
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

function loadImageAsDataUri(filePath: string): string | null {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) { return null; }

  const projectRoot = workspaceFolders[0].uri.fsPath;
  const absPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(projectRoot, filePath);

  if (!fs.existsSync(absPath)) { return null; }

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

function getAnimationEditorHtml(): string {
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
  .control-bar label { font-size: 11px; color: #7a7060; }
  .control-bar input[type="text"],
  .control-bar input[type="number"] {
    background: #1e1810; color: #c8bfb0; border: 1px solid #2e2518; border-radius: 3px;
    padding: 2px 6px; font-family: 'IBM Plex Mono', monospace; font-size: 12px;
  }
  .control-bar input[type="text"] { width: 120px; }
  .control-bar input[type="number"] { width: 52px; text-align: center; }
  .control-bar input:focus { outline: 1px solid #d4a843; }
  .control-bar input[type="checkbox"] { accent-color: #d4a843; }
  .control-bar .sep { width: 1px; height: 18px; background: #2e2518; }
  .control-bar .title { color: #d4a843; font-weight: bold; margin-right: 4px; }

  .playback-btn {
    background: #1e1810; color: #c8bfb0; border: 1px solid #2e2518; border-radius: 3px;
    padding: 2px 8px; font-family: 'IBM Plex Mono', monospace; font-size: 14px; cursor: pointer;
    min-width: 28px; text-align: center;
  }
  .playback-btn:hover { background: #271f14; color: #d4a843; }
  .playback-btn.active { background: #271f14; border-color: #d4a843; color: #d4a843; }

  /* ── Middle Area ─────────────────────────────────────────── */
  .middle { display: flex; flex: 1; overflow: hidden; }

  /* ── Animation List (left) ───────────────────────────────── */
  .anim-list {
    width: 160px; flex-shrink: 0; background: #15110c; border-right: 1px solid #2e2518;
    display: flex; flex-direction: column; overflow: hidden;
  }
  .anim-list-title {
    padding: 6px 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
    color: #7a7060; border-bottom: 1px solid #2e2518;
  }
  .anim-list-items { flex: 1; overflow-y: auto; }
  .anim-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 4px 8px; cursor: pointer; font-size: 12px;
  }
  .anim-item:hover { background: #1e1810; }
  .anim-item.selected { background: #271f14; color: #d4a843; }
  .anim-item .anim-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .anim-item .anim-delete {
    flex-shrink: 0; width: 18px; height: 18px; border: none; background: transparent;
    color: #7a7060; font-size: 12px; cursor: pointer; border-radius: 2px;
    display: flex; align-items: center; justify-content: center;
  }
  .anim-item .anim-delete:hover { background: rgba(196, 90, 138, 0.15); color: #c45a8a; }
  .anim-add {
    padding: 6px 8px; border-top: 1px solid #2e2518; cursor: pointer;
    font-size: 11px; color: #7a7060; text-align: center;
  }
  .anim-add:hover { background: #1e1810; color: #8ebc3a; }

  /* ── Preview Canvas (center) ─────────────────────────────── */
  .preview-area {
    flex: 1; position: relative; overflow: hidden; background: #0d0a07;
    background-image:
      linear-gradient(45deg, #181410 25%, transparent 25%, transparent 75%, #181410 75%),
      linear-gradient(45deg, #181410 25%, transparent 25%, transparent 75%, #181410 75%);
    background-size: 16px 16px;
    background-position: 0 0, 8px 8px;
  }
  .preview-area canvas { position: absolute; top: 0; left: 0; image-rendering: pixelated; }
  .no-image-msg {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    color: #7a7060; font-size: 13px; text-align: center;
  }

  /* ── Available Frames (right) ────────────────────────────── */
  .frame-palette {
    width: 140px; flex-shrink: 0; background: #15110c; border-left: 1px solid #2e2518;
    display: flex; flex-direction: column; overflow: hidden;
  }
  .frame-palette-title {
    padding: 6px 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
    color: #7a7060; border-bottom: 1px solid #2e2518;
  }
  .frame-palette-grid {
    flex: 1; overflow-y: auto; padding: 4px;
    display: flex; flex-wrap: wrap; gap: 3px; align-content: flex-start;
  }
  .palette-thumb {
    width: 40px; height: 40px; border: 1px solid #2e2518; border-radius: 3px;
    overflow: hidden; position: relative; cursor: pointer; background: #0d0a07;
  }
  .palette-thumb:hover { border-color: #8ebc3a; }
  .palette-thumb canvas { width: 100%; height: 100%; }
  .palette-thumb .idx {
    position: absolute; bottom: 1px; right: 2px;
    font-size: 8px; color: rgba(200,191,176,0.6);
  }

  /* ── Frame Timeline (bottom) ─────────────────────────────── */
  .timeline {
    display: flex; gap: 2px; padding: 6px 10px; background: #15110c;
    border-top: 1px solid #2e2518; overflow-x: auto; flex-shrink: 0;
    min-height: 62px; align-items: center;
  }
  .timeline-empty {
    color: #7a7060; font-size: 11px; font-style: italic;
  }
  .timeline-frame {
    flex-shrink: 0; width: 48px; height: 48px; border: 1px solid #2e2518;
    border-radius: 3px; overflow: hidden; position: relative; cursor: pointer;
    background: #0d0a07;
  }
  .timeline-frame.selected { border-color: #d4a843; border-width: 2px; }
  .timeline-frame.playing { border-color: #8ebc3a; border-width: 2px; }
  .timeline-frame.drag-over { border-color: #8ebc3a; border-style: dashed; }
  .timeline-frame canvas { width: 100%; height: 100%; }
  .timeline-frame .idx {
    position: absolute; bottom: 1px; right: 2px;
    font-size: 9px; color: rgba(200,191,176,0.6);
  }
</style>
</head>
<body>
<div id="app">
  <!-- Control Bar -->
  <div class="control-bar" id="control-bar">
    <span class="title" id="comp-name"></span>
    <div class="sep"></div>
    <label>Name:</label><input type="text" id="anim-name" placeholder="name">
    <label>FPS:</label><input type="number" id="anim-fps" value="12" min="1" step="1">
    <label>Loop:</label><input type="checkbox" id="anim-loop" checked>
    <label>onComplete:</label><input type="text" id="anim-oncomplete" placeholder="(optional)" style="width:100px;">
    <div class="sep"></div>
    <button class="playback-btn" id="btn-prev" title="Previous Frame">&#9664;</button>
    <button class="playback-btn" id="btn-play" title="Play">&#9654;</button>
    <button class="playback-btn" id="btn-pause" title="Pause">&#9646;&#9646;</button>
    <button class="playback-btn" id="btn-stop" title="Stop">&#9632;</button>
    <button class="playback-btn" id="btn-next" title="Next Frame">&#9654;</button>
  </div>

  <!-- Middle Area -->
  <div class="middle">
    <!-- Animation List -->
    <div class="anim-list">
      <div class="anim-list-title">Animations</div>
      <div class="anim-list-items" id="anim-list-items"></div>
      <div class="anim-add" id="anim-add">+ Add Animation</div>
    </div>

    <!-- Preview Canvas -->
    <div class="preview-area" id="preview-area">
      <canvas id="preview-canvas"></canvas>
      <div class="no-image-msg" id="no-image-msg" style="display:none;">No sprite texture found.<br>Ensure a sibling Sprite with a valid albedo texture map exists.</div>
    </div>

    <!-- Available Frames -->
    <div class="frame-palette">
      <div class="frame-palette-title">Frames</div>
      <div class="frame-palette-grid" id="palette-grid"></div>
    </div>
  </div>

  <!-- Frame Timeline -->
  <div class="timeline" id="timeline"></div>
</div>

<script nonce="${nonce}">
(function() {
  'use strict';

  var vscode = acquireVsCodeApi();

  // ── DOM refs ──────────────────────────────────────────────
  var compNameEl = document.getElementById('comp-name');
  var animNameInput = document.getElementById('anim-name');
  var animFpsInput = document.getElementById('anim-fps');
  var animLoopInput = document.getElementById('anim-loop');
  var animOnCompleteInput = document.getElementById('anim-oncomplete');
  var btnPrev = document.getElementById('btn-prev');
  var btnPlay = document.getElementById('btn-play');
  var btnPause = document.getElementById('btn-pause');
  var btnStop = document.getElementById('btn-stop');
  var btnNext = document.getElementById('btn-next');
  var animListItems = document.getElementById('anim-list-items');
  var animAdd = document.getElementById('anim-add');
  var previewArea = document.getElementById('preview-area');
  var previewCanvas = document.getElementById('preview-canvas');
  var previewCtx = previewCanvas.getContext('2d');
  var noImageMsg = document.getElementById('no-image-msg');
  var paletteGrid = document.getElementById('palette-grid');
  var timelineEl = document.getElementById('timeline');

  // ── State ──────────────────────────────────────────────────
  var img = null;
  var imageType = null;
  var animations = [];
  var selectedAnimIdx = -1;
  var selectedTimelineIdx = -1;
  var playbackFrame = -1;
  var playInterval = null;
  var cam = { x: 0, y: 0, zoom: 1 };
  var totalFrameCount = 0;

  // Drag state for timeline reorder
  var dragSrcIdx = -1;

  // ── Helpers ────────────────────────────────────────────────
  function getSelectedAnim() {
    if (selectedAnimIdx >= 0 && selectedAnimIdx < animations.length) {
      return animations[selectedAnimIdx];
    }
    return null;
  }

  function getFrameRect(frameIndex) {
    if (!img || !imageType) {
      return { x: 0, y: 0, w: img ? img.width : 0, h: img ? img.height : 0 };
    }
    if (imageType.mode === 'grid') {
      var cols = imageType.cols || 1;
      var cw = imageType.cellWidth || 32;
      var ch = imageType.cellHeight || 32;
      var col = frameIndex % cols;
      var row = Math.floor(frameIndex / cols);
      return { x: col * cw, y: row * ch, w: cw, h: ch };
    }
    if (imageType.mode === 'framemap' && imageType.frames) {
      var f = imageType.frames[frameIndex];
      if (f) return { x: f.x, y: f.y, w: f.w, h: f.h };
    }
    return { x: 0, y: 0, w: img ? img.width : 0, h: img ? img.height : 0 };
  }

  function computeTotalFrameCount() {
    if (!imageType) return img ? 1 : 0;
    if (imageType.mode === 'grid') {
      var cols = imageType.cols || 1;
      var rows = imageType.rows || 1;
      return imageType.cellCount || (cols * rows);
    }
    if (imageType.mode === 'framemap' && imageType.frames) {
      return imageType.frames.length;
    }
    return 1;
  }

  // ── Emit Change ───────────────────────────────────────────
  function emitChange() {
    vscode.postMessage({
      type: 'animationsChanged',
      animations: animations.map(function(a) {
        var obj = { name: a.name, frames: a.frames.slice(), frameRate: a.frameRate, loop: a.loop };
        if (a.onComplete) obj.onComplete = a.onComplete;
        return obj;
      }),
    });
  }

  // ── Animation List ────────────────────────────────────────
  function renderAnimList() {
    animListItems.innerHTML = '';
    for (var i = 0; i < animations.length; i++) {
      var item = document.createElement('div');
      item.className = 'anim-item' + (i === selectedAnimIdx ? ' selected' : '');
      item.setAttribute('data-idx', String(i));

      var nameSpan = document.createElement('span');
      nameSpan.className = 'anim-name';
      nameSpan.textContent = animations[i].name;
      item.appendChild(nameSpan);

      var delBtn = document.createElement('button');
      delBtn.className = 'anim-delete';
      delBtn.textContent = '\\u00d7';
      delBtn.title = 'Delete animation';
      delBtn.addEventListener('click', (function(idx) {
        return function(e) {
          e.stopPropagation();
          animations.splice(idx, 1);
          if (selectedAnimIdx >= animations.length) selectedAnimIdx = animations.length - 1;
          stopPlayback();
          updateControlBar();
          renderAnimList();
          renderTimeline();
          renderPreview();
          emitChange();
        };
      })(i));
      item.appendChild(delBtn);

      item.addEventListener('click', (function(idx) {
        return function() {
          selectedAnimIdx = idx;
          selectedTimelineIdx = -1;
          stopPlayback();
          updateControlBar();
          renderAnimList();
          renderTimeline();
          renderPreview();
        };
      })(i));

      animListItems.appendChild(item);
    }
  }

  animAdd.addEventListener('click', function() {
    var name = 'anim_' + animations.length;
    animations.push({ name: name, frames: [], frameRate: 12, loop: true });
    selectedAnimIdx = animations.length - 1;
    selectedTimelineIdx = -1;
    stopPlayback();
    updateControlBar();
    renderAnimList();
    renderTimeline();
    renderPreview();
    emitChange();
  });

  // ── Control Bar ───────────────────────────────────────────
  function updateControlBar() {
    var anim = getSelectedAnim();
    if (anim) {
      animNameInput.value = anim.name;
      animFpsInput.value = anim.frameRate;
      animLoopInput.checked = anim.loop;
      animOnCompleteInput.value = anim.onComplete || '';
      animNameInput.disabled = false;
      animFpsInput.disabled = false;
      animLoopInput.disabled = false;
      animOnCompleteInput.disabled = false;
    } else {
      animNameInput.value = '';
      animFpsInput.value = '12';
      animLoopInput.checked = true;
      animOnCompleteInput.value = '';
      animNameInput.disabled = true;
      animFpsInput.disabled = true;
      animLoopInput.disabled = true;
      animOnCompleteInput.disabled = true;
    }
  }

  animNameInput.addEventListener('change', function() {
    var anim = getSelectedAnim();
    if (anim) {
      anim.name = animNameInput.value || 'unnamed';
      renderAnimList();
      emitChange();
    }
  });

  animFpsInput.addEventListener('change', function() {
    var anim = getSelectedAnim();
    if (anim) {
      anim.frameRate = Math.max(1, parseInt(animFpsInput.value) || 12);
      emitChange();
    }
  });

  animLoopInput.addEventListener('change', function() {
    var anim = getSelectedAnim();
    if (anim) {
      anim.loop = animLoopInput.checked;
      emitChange();
    }
  });

  animOnCompleteInput.addEventListener('change', function() {
    var anim = getSelectedAnim();
    if (anim) {
      anim.onComplete = animOnCompleteInput.value || undefined;
      emitChange();
    }
  });

  // ── Playback ──────────────────────────────────────────────
  function startPlayback() {
    var anim = getSelectedAnim();
    if (!anim || anim.frames.length === 0 || !img) return;
    stopPlayback();
    playbackFrame = 0;
    btnPlay.classList.add('active');
    renderPreview();
    renderTimeline();
    var interval = 1000 / (anim.frameRate || 12);
    playInterval = setInterval(function() {
      var a = getSelectedAnim();
      if (!a || a.frames.length === 0) { stopPlayback(); return; }
      playbackFrame++;
      if (playbackFrame >= a.frames.length) {
        if (a.loop) {
          playbackFrame = 0;
        } else {
          playbackFrame = a.frames.length - 1;
          stopPlayback();
          return;
        }
      }
      renderPreview();
      renderTimeline();
    }, interval);
  }

  function stopPlayback() {
    if (playInterval) { clearInterval(playInterval); playInterval = null; }
    playbackFrame = -1;
    btnPlay.classList.remove('active');
    btnPause.classList.remove('active');
  }

  function pausePlayback() {
    if (playInterval) {
      clearInterval(playInterval);
      playInterval = null;
      btnPlay.classList.remove('active');
      btnPause.classList.add('active');
    }
  }

  btnPlay.addEventListener('click', startPlayback);
  btnPause.addEventListener('click', pausePlayback);
  btnStop.addEventListener('click', function() {
    stopPlayback();
    renderPreview();
    renderTimeline();
  });
  btnPrev.addEventListener('click', function() {
    var anim = getSelectedAnim();
    if (!anim || anim.frames.length === 0) return;
    stopPlayback();
    if (selectedTimelineIdx <= 0) {
      selectedTimelineIdx = anim.frames.length - 1;
    } else {
      selectedTimelineIdx--;
    }
    renderPreview();
    renderTimeline();
  });
  btnNext.addEventListener('click', function() {
    var anim = getSelectedAnim();
    if (!anim || anim.frames.length === 0) return;
    stopPlayback();
    if (selectedTimelineIdx >= anim.frames.length - 1) {
      selectedTimelineIdx = 0;
    } else {
      selectedTimelineIdx++;
    }
    renderPreview();
    renderTimeline();
  });

  // ── Preview Canvas ────────────────────────────────────────
  function renderPreview() {
    var w = previewArea.clientWidth;
    var h = previewArea.clientHeight;
    previewCanvas.width = w;
    previewCanvas.height = h;
    previewCtx.clearRect(0, 0, w, h);

    if (!img) { noImageMsg.style.display = ''; return; }
    noImageMsg.style.display = 'none';

    previewCtx.imageSmoothingEnabled = false;

    // Determine which frame to show
    var anim = getSelectedAnim();
    var frameIdx = -1;
    if (anim && anim.frames.length > 0) {
      if (playbackFrame >= 0) {
        frameIdx = anim.frames[playbackFrame];
      } else if (selectedTimelineIdx >= 0 && selectedTimelineIdx < anim.frames.length) {
        frameIdx = anim.frames[selectedTimelineIdx];
      } else {
        frameIdx = anim.frames[0];
      }
    }

    if (frameIdx >= 0 && frameIdx < totalFrameCount) {
      var rect = getFrameRect(frameIdx);
      // Center and scale the frame in the preview
      var scale = Math.min((w - 40) / rect.w, (h - 40) / rect.h, 8);
      scale = Math.max(1, scale);
      var dw = rect.w * scale;
      var dh = rect.h * scale;
      var dx = (w - dw) / 2;
      var dy = (h - dh) / 2;
      previewCtx.drawImage(img, rect.x, rect.y, rect.w, rect.h, dx, dy, dw, dh);

      // Border
      previewCtx.strokeStyle = 'rgba(200,191,176,0.2)';
      previewCtx.lineWidth = 1;
      previewCtx.strokeRect(dx, dy, dw, dh);

      // Frame info label
      previewCtx.fillStyle = '#7a7060';
      previewCtx.font = "11px 'IBM Plex Mono', monospace";
      var label = 'Frame ' + frameIdx;
      if (playbackFrame >= 0) label += ' [' + (playbackFrame + 1) + '/' + anim.frames.length + ']';
      previewCtx.fillText(label, 8, h - 8);
    } else {
      previewCtx.fillStyle = '#7a7060';
      previewCtx.font = "13px 'IBM Plex Mono', monospace";
      previewCtx.textAlign = 'center';
      previewCtx.fillText(anim ? 'No frames in animation' : 'Select an animation', w / 2, h / 2);
      previewCtx.textAlign = 'start';
    }
  }

  // ── Available Frames Palette ──────────────────────────────
  function renderPalette() {
    paletteGrid.innerHTML = '';
    if (!img) return;

    for (var i = 0; i < totalFrameCount; i++) {
      var thumb = document.createElement('div');
      thumb.className = 'palette-thumb';
      thumb.setAttribute('data-frame', String(i));

      var tc = document.createElement('canvas');
      tc.width = 40;
      tc.height = 40;
      var tctx = tc.getContext('2d');
      tctx.imageSmoothingEnabled = false;

      var rect = getFrameRect(i);
      var scale = Math.min(38 / rect.w, 38 / rect.h, 4);
      var dw = rect.w * scale;
      var dh = rect.h * scale;
      var dx = (40 - dw) / 2;
      var dy = (40 - dh) / 2;
      tctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, dx, dy, dw, dh);

      thumb.appendChild(tc);

      var idx = document.createElement('span');
      idx.className = 'idx';
      idx.textContent = String(i);
      thumb.appendChild(idx);

      thumb.addEventListener('click', (function(frameNum) {
        return function() {
          var anim = getSelectedAnim();
          if (!anim) return;
          // Insert at selected timeline position, or append
          if (selectedTimelineIdx >= 0 && selectedTimelineIdx < anim.frames.length) {
            anim.frames.splice(selectedTimelineIdx, 0, frameNum);
          } else {
            anim.frames.push(frameNum);
          }
          stopPlayback();
          renderTimeline();
          renderPreview();
          emitChange();
        };
      })(i));

      paletteGrid.appendChild(thumb);
    }
  }

  // ── Frame Timeline ────────────────────────────────────────
  function renderTimeline() {
    timelineEl.innerHTML = '';
    var anim = getSelectedAnim();
    if (!anim) {
      var empty = document.createElement('span');
      empty.className = 'timeline-empty';
      empty.textContent = 'Select an animation to view its frames';
      timelineEl.appendChild(empty);
      return;
    }
    if (anim.frames.length === 0) {
      var empty2 = document.createElement('span');
      empty2.className = 'timeline-empty';
      empty2.textContent = 'Click frames on the right to add them';
      timelineEl.appendChild(empty2);
      return;
    }

    for (var i = 0; i < anim.frames.length; i++) {
      var frameNum = anim.frames[i];
      var el = document.createElement('div');
      el.className = 'timeline-frame';
      if (i === selectedTimelineIdx && playbackFrame < 0) el.className += ' selected';
      if (i === playbackFrame && playbackFrame >= 0) el.className += ' playing';
      el.setAttribute('data-tidx', String(i));
      el.setAttribute('draggable', 'true');

      if (img && frameNum >= 0 && frameNum < totalFrameCount) {
        var tc = document.createElement('canvas');
        tc.width = 48;
        tc.height = 48;
        var tctx = tc.getContext('2d');
        tctx.imageSmoothingEnabled = false;

        var rect = getFrameRect(frameNum);
        var scale = Math.min(46 / rect.w, 46 / rect.h, 4);
        var dw = rect.w * scale;
        var dh = rect.h * scale;
        var dx = (48 - dw) / 2;
        var dy = (48 - dh) / 2;
        tctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, dx, dy, dw, dh);
        el.appendChild(tc);
      }

      var idx = document.createElement('span');
      idx.className = 'idx';
      idx.textContent = String(frameNum);
      el.appendChild(idx);

      // Left-click: select
      el.addEventListener('click', (function(tIdx) {
        return function() {
          selectedTimelineIdx = tIdx;
          stopPlayback();
          renderTimeline();
          renderPreview();
        };
      })(i));

      // Right-click: remove
      el.addEventListener('contextmenu', (function(tIdx) {
        return function(e) {
          e.preventDefault();
          var a = getSelectedAnim();
          if (!a) return;
          a.frames.splice(tIdx, 1);
          if (selectedTimelineIdx >= a.frames.length) selectedTimelineIdx = a.frames.length - 1;
          stopPlayback();
          renderTimeline();
          renderPreview();
          emitChange();
        };
      })(i));

      // Drag-and-drop reorder
      el.addEventListener('dragstart', (function(tIdx) {
        return function(e) {
          dragSrcIdx = tIdx;
          e.dataTransfer.effectAllowed = 'move';
        };
      })(i));

      el.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        this.classList.add('drag-over');
      });

      el.addEventListener('dragleave', function() {
        this.classList.remove('drag-over');
      });

      el.addEventListener('drop', (function(tIdx) {
        return function(e) {
          e.preventDefault();
          this.classList.remove('drag-over');
          var a = getSelectedAnim();
          if (!a || dragSrcIdx < 0) return;
          var moved = a.frames.splice(dragSrcIdx, 1)[0];
          var insertAt = dragSrcIdx < tIdx ? tIdx : tIdx;
          a.frames.splice(insertAt, 0, moved);
          selectedTimelineIdx = insertAt;
          dragSrcIdx = -1;
          stopPlayback();
          renderTimeline();
          renderPreview();
          emitChange();
        };
      })(i));

      timelineEl.appendChild(el);
    }
  }

  // ── Message Handler ───────────────────────────────────────
  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (msg.type === 'load') {
      compNameEl.textContent = msg.componentName || '';
      animations = (msg.animations || []).map(function(a) {
        return {
          name: a.name,
          frames: (a.frames || []).slice(),
          frameRate: a.frameRate || 12,
          loop: a.loop !== undefined ? a.loop : true,
          onComplete: a.onComplete || undefined,
        };
      });
      imageType = msg.imageType || null;

      // Select first animation if available
      selectedAnimIdx = animations.length > 0 ? 0 : -1;
      selectedTimelineIdx = -1;
      stopPlayback();

      if (msg.imageData) {
        var newImg = new Image();
        newImg.onload = function() {
          img = newImg;
          noImageMsg.style.display = 'none';
          totalFrameCount = computeTotalFrameCount();
          updateControlBar();
          renderAnimList();
          renderPalette();
          renderTimeline();
          renderPreview();
        };
        newImg.src = msg.imageData;
      } else {
        img = null;
        totalFrameCount = 0;
        noImageMsg.style.display = '';
        updateControlBar();
        renderAnimList();
        renderPalette();
        renderTimeline();
        renderPreview();
      }
    }
  });

  // ── Resize Observer ───────────────────────────────────────
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

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
