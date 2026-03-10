/**
 * Editor overlay script — injected into the browser preview.
 * Provides: console interception, selection/bounding boxes, click-to-select,
 * transform gizmo (T/R/E modes), grid overlay, camera controls, perf overlay.
 */

export function getOverlayScript(wsPort: number): string {
  return `
(function() {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────
  var PROTOCOL = 'omosuen-editor/v1';
  var WS_URL = 'ws://localhost:${wsPort}/editor';
  var GIZMO_LENGTH = 80;
  var GIZMO_HIT_DIST = 12;
  var DEFAULT_HIT_RADIUS = 16;
  var AXIS_COLORS = { x: '#FF4444', y: '#44FF44', z: '#4488FF' };
  var AXIS_HOVER = { x: '#FF8888', y: '#88FF88', z: '#88BBFF' };

  function getAngleValues(cam) {
    var angle = (cam && cam.angle !== undefined) ? cam.angle : 30;
    angle = Math.max(0, Math.min(90, angle));
    var rad = angle * Math.PI / 180;
    return { cos: 0.8660254, sin: Math.sin(rad), hs: Math.cos(rad) * 1.1547005 };
  }

  function getAxisDirs(av) {
    return {
      x: { x: av.cos, y: -av.sin },
      y: { x: 0, y: -av.hs },
      z: { x: -av.cos, y: -av.sin },
    };
  }

  // ── State ──────────────────────────────────────────────────────
  var ws = null;
  var reconnectTimer = null;
  var msgCounter = 0;
  var selectedComponentId = null;
  var gizmoMode = 'translate';
  var draggingAxis = null;
  var hoveredAxis = null;
  var dragStartMouse = null;
  var dragStartValue = null;
  var gridVisible = false;
  var overlayCanvas = null;
  var ctx = null;

  // ── Console Interception ───────────────────────────────────────

  var originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
  };

  var recentMessages = {};
  var DEDUP_WINDOW = 2000;

  function interceptConsole() {
    ['log', 'info', 'warn', 'error'].forEach(function(level) {
      console[level] = function() {
        originalConsole[level].apply(console, arguments);
        var message = Array.prototype.slice.call(arguments)
          .map(function(arg) {
            if (typeof arg === 'object') {
              try { return JSON.stringify(arg); } catch(e) { return String(arg); }
            }
            return String(arg);
          }).join(' ');
        var tag = undefined;
        var tagMatch = message.match(/^\\[([^\\]]+)\\]/);
        if (tagMatch) tag = tagMatch[1];
        var logLevel = (level === 'log' || level === 'info') ? 'info' : level;

        var dedupKey = logLevel + ':' + message;
        var now = Date.now();
        if (recentMessages[dedupKey] && (now - recentMessages[dedupKey].time) < DEDUP_WINDOW) {
          recentMessages[dedupKey].count++;
          return;
        }
        if (recentMessages[dedupKey] && recentMessages[dedupKey].count > 1) {
          sendMessage('preview:log', {
            level: logLevel,
            message: '... repeated ' + recentMessages[dedupKey].count + 'x: ' + message,
            tag: tag
          });
        }
        recentMessages[dedupKey] = { time: now, count: 1 };
        sendMessage('preview:log', { level: logLevel, message: message, tag: tag });
      };
    });
  }

  // ── WebSocket Connection ───────────────────────────────────────

  function createMessage(type, payload) {
    return JSON.stringify({
      protocol: PROTOCOL,
      id: 'overlay_' + Date.now() + '_' + (msgCounter++),
      type: type,
      payload: payload
    });
  }

  function sendMessage(type, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(createMessage(type, payload));
    }
  }

  function connect() {
    try {
      ws = new WebSocket(WS_URL);
      ws.onopen = function() {
        originalConsole.info('[Omosuen Editor] Connected to extension');
        var engineVersion = '0.1.0';
        if (window.Omosuen && window.Omosuen.version) engineVersion = window.Omosuen.version;
        sendMessage('preview:ready', { engineVersion: engineVersion, contractVersion: 1 });
      };
      ws.onmessage = function(event) {
        try {
          var msg = JSON.parse(event.data);
          if (msg.protocol !== PROTOCOL) return;
          handleMessage(msg);
        } catch(e) {
          originalConsole.error('[Omosuen Editor] Failed to parse message:', e);
        }
      };
      ws.onclose = function() {
        originalConsole.info('[Omosuen Editor] Disconnected, reconnecting in 2s...');
        ws = null;
        scheduleReconnect();
      };
      ws.onerror = function() {};
    } catch(e) {
      originalConsole.error('[Omosuen Editor] WebSocket error:', e);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function() {
      reconnectTimer = null;
      connect();
    }, 2000);
  }

  // ── Live Editing Helpers ───────────────────────────────────────

  function reconstructValue(value) {
    if (value === null || value === undefined || typeof value !== 'object') return value;
    if (!window.Omosuen) return value;
    if (value._vectorType === 'Vector2D' && window.Omosuen.Vector2D)
      return new window.Omosuen.Vector2D(value.x || 0, value.y || 0);
    if (value._vectorType === 'Vector3D' && window.Omosuen.Vector3D)
      return new window.Omosuen.Vector3D(value.x || 0, value.y || 0, value.z || 0);
    if (value._vectorType === 'Vector4D' && window.Omosuen.Vector4D)
      return new window.Omosuen.Vector4D(value.x || 0, value.y || 0, value.z || 0, value.w || 0);
    if (Array.isArray(value)) return value;
    var result = {};
    for (var key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) result[key] = reconstructValue(value[key]);
    }
    return result;
  }

  function setNestedProperty(obj, path, value) {
    var parts = path.split('.');
    var current = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (current[parts[i]] === undefined || current[parts[i]] === null) current[parts[i]] = {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
  }

  // ── Projection Math ───────────────────────────────────────────

  function getCameraInfo() {
    if (!window.Omosuen || !window.Omosuen.getActiveScene) return null;
    var scene = window.Omosuen.getActiveScene();
    if (!scene) return null;
    var camera = scene.getComponentByType('camera', true);
    if (!camera) return null;
    var transform = camera.parent && camera.parent.getComponentByType
      ? camera.parent.getComponentByType('transform') : null;
    var viewport = camera.parent && camera.parent.getComponentByType
      ? camera.parent.getComponentByType('viewport') : null;
    var angle = camera.axonometricAngle !== undefined ? camera.axonometricAngle : 30;
    angle = Math.max(0, Math.min(90, angle));
    var rad = angle * Math.PI / 180;
    var sinA = Math.sin(rad);
    var heightScale = Math.cos(rad) * 1.1547005;
    var ISO_H = 0.8660254; // cos(30deg) — constant horizontal spread
    return {
      panX: transform && transform.position
        ? ISO_H * transform.position.x - ISO_H * transform.position.z : 0,
      panY: transform && transform.position
        ? sinA * transform.position.x - heightScale * transform.position.y + sinA * transform.position.z : 0,
      zoom: camera.zoom !== undefined ? camera.zoom : 1,
      vpW: viewport ? viewport.width : 800,
      vpH: viewport ? viewport.height : 600,
      vpOffX: viewport ? (viewport.offsetX || 0) : 0,
      vpOffY: viewport ? (viewport.offsetY || 0) : 0,
      angle: angle,
    };
  }

  function worldToScreen(wx, wy, wz, cam) {
    var av = getAngleValues(cam);
    var isoX = av.cos * wx - av.cos * wz;
    var isoY = av.sin * wx - av.hs * wy + av.sin * wz;
    return {
      x: (isoX - cam.panX) * cam.zoom + cam.vpW / 2,
      y: cam.vpH / 2 - (isoY - cam.panY) * cam.zoom,
    };
  }

  function screenToWorld(sx, sy, cam, planeY) {
    planeY = planeY || 0;
    var av = getAngleValues(cam);
    var isoX = (sx - cam.vpW / 2) / cam.zoom + cam.panX;
    var isoY = -((sy - cam.vpH / 2) / cam.zoom) + cam.panY;
    var adjustedIsoY = isoY + av.hs * planeY;
    if (av.sin < 0.01) {
      return { x: adjustedIsoY, y: planeY, z: adjustedIsoY - isoX / av.cos };
    }
    var u = adjustedIsoY / av.sin;
    var v = isoX / av.cos;
    return { x: (u + v) / 2, y: planeY, z: (u - v) / 2 };
  }

  // ── Scene Traversal & Bounds ───────────────────────────────────

  function traverseScene(scene, callback) {
    if (!scene || scene.type !== 'nexus') return;
    traverseNexus(scene, callback);
  }

  function traverseNexus(nexus, callback) {
    var transform = null;
    if (nexus.getComponentByType) transform = nexus.getComponentByType('transform');
    callback(nexus, transform);
    if (nexus.type === 'nexus' && nexus.components) {
      for (var i = 0; i < nexus.components.length; i++) {
        var child = nexus.components[i];
        if (child.type === 'nexus') traverseNexus(child, callback);
      }
    }
  }

  function getEntityBounds(nexus) {
    if (nexus.getComponentByType) {
      var collider = nexus.getComponentByType('collider');
      if (collider) {
        if (collider.shape === 'box' && collider.size) {
          return { type: 'box',
            halfW: collider.size.x || 16, halfH: collider.size.y || 16, halfD: collider.size.z || 16,
            offX: collider.offset ? (collider.offset.x || 0) : 0,
            offY: collider.offset ? (collider.offset.y || 0) : 0,
            offZ: collider.offset ? (collider.offset.z || 0) : 0 };
        }
        if (collider.shape === 'sphere' && collider.radius) {
          return { type: 'sphere', radius: collider.radius,
            offX: collider.offset ? (collider.offset.x || 0) : 0,
            offY: collider.offset ? (collider.offset.y || 0) : 0,
            offZ: collider.offset ? (collider.offset.z || 0) : 0 };
        }
      }
      var cellMap = nexus.getComponentByType('cell-map');
      if (cellMap && cellMap.cellSize && cellMap.mapSize) {
        var tw = cellMap.cellSize.x * cellMap.mapSize.x;
        var th = cellMap.cellSize.y * cellMap.mapSize.y;
        var td = cellMap.cellSize.z * cellMap.mapSize.z;
        return { type: 'box', halfW: tw/2, halfH: th/2, halfD: td/2, offX: tw/2, offY: th/2, offZ: td/2 };
      }
    }
    return { type: 'sphere', radius: DEFAULT_HIT_RADIUS / 2, offX: 0, offY: 0, offZ: 0 };
  }

  // ── Overlay Canvas ─────────────────────────────────────────────

  function createOverlayCanvas() {
    overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = '__omosuen_editor_canvas';
    overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:auto;z-index:99997;cursor:default;';
    document.body.appendChild(overlayCanvas);
    ctx = overlayCanvas.getContext('2d');
    overlayCanvas.addEventListener('mousedown', onCanvasMouseDown);
    overlayCanvas.addEventListener('mousemove', onCanvasMouseMove);
    overlayCanvas.addEventListener('mouseup', onCanvasMouseUp);
  }

  function syncOverlayCanvas() {
    var cam = getCameraInfo();
    if (!cam || !overlayCanvas) return;
    if (overlayCanvas.width !== cam.vpW) overlayCanvas.width = cam.vpW;
    if (overlayCanvas.height !== cam.vpH) overlayCanvas.height = cam.vpH;
    overlayCanvas.style.left = cam.vpOffX + 'px';
    overlayCanvas.style.top = cam.vpOffY + 'px';
    overlayCanvas.style.width = cam.vpW + 'px';
    overlayCanvas.style.height = cam.vpH + 'px';
  }

  function startOverlayLoop() {
    requestAnimationFrame(overlayFrame);
  }

  function overlayFrame() {
    syncOverlayCanvas();
    drawOverlay();
    requestAnimationFrame(overlayFrame);
  }

  function drawOverlay() {
    if (!ctx || !overlayCanvas) return;
    var cam = getCameraInfo();
    if (!cam) return;
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    if (gridVisible) drawGrid(ctx, cam);

    if (selectedComponentId !== null) {
      var scene = window.Omosuen && window.Omosuen.getActiveScene && window.Omosuen.getActiveScene();
      if (scene) {
        var comp = scene.getComponentById(selectedComponentId, true);
        if (comp) {
          var nexus = comp.type === 'nexus' ? comp : comp.parent;
          if (nexus) {
            var transform = nexus.getComponentByType ? nexus.getComponentByType('transform') : null;
            if (transform && transform.position) {
              var pos = transform.position;
              var sp = worldToScreen(pos.x, pos.y, pos.z, cam);
              drawBoundingBox(ctx, pos, getEntityBounds(nexus), cam);
              drawGizmo(ctx, sp, cam);
              drawSelectionLabel(ctx, sp, comp);
            }
          }
        }
      }
    }
  }

  // ── Bounding Box Drawing ───────────────────────────────────────

  function drawBoundingBox(ctx, wp, bounds, cam) {
    ctx.strokeStyle = '#50A0FF';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    if (bounds.type === 'box') {
      var cx = wp.x + bounds.offX, cy = wp.y + bounds.offY, cz = wp.z + bounds.offZ;
      var hw = bounds.halfW, hh = bounds.halfH, hd = bounds.halfD;
      var c = [
        worldToScreen(cx-hw,cy-hh,cz-hd,cam), worldToScreen(cx+hw,cy-hh,cz-hd,cam),
        worldToScreen(cx+hw,cy-hh,cz+hd,cam), worldToScreen(cx-hw,cy-hh,cz+hd,cam),
        worldToScreen(cx-hw,cy+hh,cz-hd,cam), worldToScreen(cx+hw,cy+hh,cz-hd,cam),
        worldToScreen(cx+hw,cy+hh,cz+hd,cam), worldToScreen(cx-hw,cy+hh,cz+hd,cam),
      ];
      drawQuad(ctx,c[0],c[1],c[2],c[3]);
      drawQuad(ctx,c[4],c[5],c[6],c[7]);
      for (var i=0;i<4;i++) drawLineSeg(ctx,c[i],c[i+4]);
    } else if (bounds.type === 'sphere') {
      var center = worldToScreen(wp.x+bounds.offX, wp.y+bounds.offY, wp.z+bounds.offZ, cam);
      ctx.beginPath();
      ctx.arc(center.x, center.y, bounds.radius * cam.zoom, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  function drawQuad(ctx, a, b, c, d) {
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
    ctx.lineTo(c.x,c.y); ctx.lineTo(d.x,d.y); ctx.closePath(); ctx.stroke();
  }

  function drawLineSeg(ctx, a, b) {
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
  }

  function drawSelectionLabel(ctx, sp, comp) {
    var label = (comp.name || comp.type) + ' #' + comp.id;
    ctx.font = '11px monospace';
    var m = ctx.measureText(label);
    ctx.fillStyle = 'rgba(50, 120, 220, 0.85)';
    ctx.fillRect(sp.x - m.width/2 - 4, sp.y - 35, m.width + 8, 16);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, sp.x - m.width/2, sp.y - 23);
  }

  // ── Click-to-Select ────────────────────────────────────────────

  function findEntityAtPoint(sx, sy, cam) {
    if (!window.Omosuen || !window.Omosuen.getActiveScene) return null;
    var scene = window.Omosuen.getActiveScene();
    if (!scene) return null;
    var best = null, bestDist = Infinity, bestDepth = -Infinity;
    traverseScene(scene, function(nexus, transform) {
      if (!transform || !transform.position) return;
      var pos = transform.position;
      var sp = worldToScreen(pos.x, pos.y, pos.z, cam);
      var bounds = getEntityBounds(nexus);
      var hitRadius = bounds.type === 'sphere'
        ? Math.max(bounds.radius * cam.zoom, DEFAULT_HIT_RADIUS)
        : Math.max(Math.max(bounds.halfW, bounds.halfD) * cam.zoom, DEFAULT_HIT_RADIUS);
      var dx = sx - sp.x, dy = sy - sp.y;
      var dist = Math.sqrt(dx*dx + dy*dy);
      if (dist <= hitRadius) {
        var depth = pos.x + pos.y + pos.z;
        if (depth > bestDepth || (depth === bestDepth && dist < bestDist)) {
          best = nexus; bestDist = dist; bestDepth = depth;
        }
      }
    });
    return best;
  }

  function onCanvasMouseDown(e) {
    var cam = getCameraInfo();
    if (!cam) return;
    var rect = overlayCanvas.getBoundingClientRect();
    var mx = e.clientX - rect.left, my = e.clientY - rect.top;

    // Check gizmo interaction first
    if (selectedComponentId !== null) {
      var scene = window.Omosuen && window.Omosuen.getActiveScene && window.Omosuen.getActiveScene();
      if (scene) {
        var comp = scene.getComponentById(selectedComponentId, true);
        if (comp) {
          var nexus = comp.type === 'nexus' ? comp : comp.parent;
          if (nexus && nexus.getComponentByType) {
            var transform = nexus.getComponentByType('transform');
            if (transform && transform.position) {
              var sp = worldToScreen(transform.position.x, transform.position.y, transform.position.z, cam);
              var axis = hitTestGizmo(mx, my, sp.x, sp.y);
              if (axis) { startGizmoDrag(axis, mx, my, transform, cam); e.stopPropagation(); return; }
            }
          }
        }
      }
    }
    // Click-to-select
    var entity = findEntityAtPoint(mx, my, cam);
    if (entity) {
      selectedComponentId = entity.id;
      sendMessage('component:selected', { componentId: entity.id });
    } else {
      selectedComponentId = null;
      sendMessage('component:selected', { componentId: null });
    }
  }

  function onCanvasMouseMove(e) {
    var cam = getCameraInfo();
    if (!cam) return;
    var rect = overlayCanvas.getBoundingClientRect();
    var mx = e.clientX - rect.left, my = e.clientY - rect.top;

    if (draggingAxis) { updateGizmoDrag(mx, my, cam); e.stopPropagation(); return; }

    if (selectedComponentId !== null) {
      var scene = window.Omosuen && window.Omosuen.getActiveScene && window.Omosuen.getActiveScene();
      if (scene) {
        var comp = scene.getComponentById(selectedComponentId, true);
        if (comp) {
          var nexus = comp.type === 'nexus' ? comp : comp.parent;
          if (nexus && nexus.getComponentByType) {
            var transform = nexus.getComponentByType('transform');
            if (transform && transform.position) {
              var sp = worldToScreen(transform.position.x, transform.position.y, transform.position.z, cam);
              hoveredAxis = hitTestGizmo(mx, my, sp.x, sp.y);
              overlayCanvas.style.cursor = hoveredAxis ? 'pointer' : 'default';
              return;
            }
          }
        }
      }
    }
    hoveredAxis = null;
    overlayCanvas.style.cursor = 'default';
  }

  function onCanvasMouseUp(e) {
    if (draggingAxis) { endGizmoDrag(); e.stopPropagation(); }
  }

  // ── Transform Gizmo ────────────────────────────────────────────

  function drawGizmo(ctx, sp, cam) {
    var cx = sp.x, cy = sp.y;
    if (gizmoMode === 'translate') drawTranslateGizmo(ctx, cx, cy, cam);
    else if (gizmoMode === 'rotate') drawRotateGizmo(ctx, cx, cy, cam);
    else if (gizmoMode === 'scale') drawScaleGizmo(ctx, cx, cy, cam);
    ctx.font = '10px monospace'; ctx.fillStyle = '#fff';
    ctx.fillText(gizmoMode.charAt(0).toUpperCase(), cx + 6, cy + 18);
  }

  function drawAxisLine(ctx, cx, cy, axis, endShape, cam) {
    var axisDirs = getAxisDirs(getAngleValues(cam));
    var dir = axisDirs[axis];
    var color = (hoveredAxis === axis || draggingAxis === axis) ? AXIS_HOVER[axis] : AXIS_COLORS[axis];
    var lw = (hoveredAxis === axis || draggingAxis === axis) ? 3 : 2;
    var ex = cx + dir.x * GIZMO_LENGTH, ey = cy + dir.y * GIZMO_LENGTH;
    ctx.strokeStyle = color; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(ex,ey); ctx.stroke();
    ctx.fillStyle = color;
    if (endShape === 'arrow') {
      var angle = Math.atan2(dir.y, dir.x);
      ctx.beginPath(); ctx.moveTo(ex,ey);
      ctx.lineTo(ex - 10*Math.cos(angle-0.4), ey - 10*Math.sin(angle-0.4));
      ctx.lineTo(ex - 10*Math.cos(angle+0.4), ey - 10*Math.sin(angle+0.4));
      ctx.closePath(); ctx.fill();
    } else if (endShape === 'square') {
      ctx.fillRect(ex-4, ey-4, 8, 8);
    }
    ctx.font = 'bold 11px monospace';
    ctx.fillText(axis.toUpperCase(), ex + dir.x*8, ey + dir.y*8);
  }

  function drawTranslateGizmo(ctx, cx, cy, cam) {
    drawAxisLine(ctx,cx,cy,'x','arrow',cam);
    drawAxisLine(ctx,cx,cy,'y','arrow',cam);
    drawAxisLine(ctx,cx,cy,'z','arrow',cam);
    ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(cx,cy,4,0,Math.PI*2); ctx.fill();
  }

  function drawScaleGizmo(ctx, cx, cy, cam) {
    drawAxisLine(ctx,cx,cy,'x','square',cam);
    drawAxisLine(ctx,cx,cy,'y','square',cam);
    drawAxisLine(ctx,cx,cy,'z','square',cam);
    ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(cx,cy,4,0,Math.PI*2); ctx.fill();
  }

  function drawRotateGizmo(ctx, cx, cy, cam) {
    var axes = ['x','y','z'];
    var arcR = 50;
    for (var i=0;i<3;i++) {
      var axis = axes[i];
      var color = (hoveredAxis === axis || draggingAxis === axis) ? AXIS_HOVER[axis] : AXIS_COLORS[axis];
      ctx.strokeStyle = color;
      ctx.lineWidth = (hoveredAxis === axis || draggingAxis === axis) ? 3 : 1.5;
      ctx.beginPath();
      for (var s=0;s<=32;s++) {
        var a = (s/32)*Math.PI*2;
        var wx=0,wy=0,wz=0;
        if (axis==='x') { wy=Math.cos(a)*arcR/cam.zoom; wz=Math.sin(a)*arcR/cam.zoom; }
        else if (axis==='y') { wx=Math.cos(a)*arcR/cam.zoom; wz=Math.sin(a)*arcR/cam.zoom; }
        else { wx=Math.cos(a)*arcR/cam.zoom; wy=Math.sin(a)*arcR/cam.zoom; }
        var av = getAngleValues(cam);
        var ix = av.cos*wx - av.cos*wz;
        var iy = av.sin*wx - wy + av.sin*wz;
        var px = cx + ix*cam.zoom, py = cy - iy*cam.zoom;
        if (s===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
      }
      ctx.stroke();
      ctx.font='bold 11px monospace'; ctx.fillStyle=color;
      ctx.fillText(axis.toUpperCase(), cx + (axis==='z'?-60:axis==='x'?60:0), cy + (axis==='y'?-55:-55));
    }
    ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(cx,cy,4,0,Math.PI*2); ctx.fill();
  }

  function hitTestGizmo(mx, my, cx, cy) {
    var axes = ['x','y','z'];
    if (gizmoMode === 'rotate') {
      // Hit test rotation arcs
      var cam = getCameraInfo();
      if (!cam) return null;
      var av = getAngleValues(cam);
      var arcR = 50;
      for (var i=0;i<3;i++) {
        var axis = axes[i];
        for (var s=0;s<32;s++) {
          var a1 = (s/32)*Math.PI*2, a2 = ((s+1)/32)*Math.PI*2;
          for (var t=0;t<=1;t++) {
            var a = a1 + t*(a2-a1);
            var wx=0,wy=0,wz=0;
            if (axis==='x') { wy=Math.cos(a)*arcR/cam.zoom; wz=Math.sin(a)*arcR/cam.zoom; }
            else if (axis==='y') { wx=Math.cos(a)*arcR/cam.zoom; wz=Math.sin(a)*arcR/cam.zoom; }
            else { wx=Math.cos(a)*arcR/cam.zoom; wy=Math.sin(a)*arcR/cam.zoom; }
            var ix=av.cos*wx-av.cos*wz, iy=av.sin*wx-wy+av.sin*wz;
            var px=cx+ix*cam.zoom, py=cy-iy*cam.zoom;
            var dd=(mx-px)*(mx-px)+(my-py)*(my-py);
            if (dd < GIZMO_HIT_DIST*GIZMO_HIT_DIST) return axis;
          }
        }
      }
      return null;
    }
    // Hit test lines (translate/scale)
    var cam2 = getCameraInfo();
    var axisDirs = getAxisDirs(getAngleValues(cam2));
    for (var i=0;i<3;i++) {
      var axis = axes[i];
      var dir = axisDirs[axis];
      var adx = dir.x*GIZMO_LENGTH, ady = dir.y*GIZMO_LENGTH;
      var dot = (mx-cx)*adx + (my-cy)*ady;
      var lenSq = adx*adx + ady*ady;
      var t = Math.max(0.1, Math.min(1, dot/lenSq));
      var closestX = cx+t*adx, closestY = cy+t*ady;
      var distSq = (mx-closestX)*(mx-closestX) + (my-closestY)*(my-closestY);
      if (distSq < GIZMO_HIT_DIST*GIZMO_HIT_DIST) return axis;
    }
    return null;
  }

  function startGizmoDrag(axis, mx, my, transform, cam) {
    draggingAxis = axis;
    dragStartMouse = { x: mx, y: my };
    dragStartValue = {
      x: transform.position.x, y: transform.position.y, z: transform.position.z,
      rotX: transform.rotation ? transform.rotation.x : 0,
      rotY: transform.rotation ? transform.rotation.y : 0,
      rotZ: transform.rotation ? transform.rotation.z : 0,
      scaleX: transform.scale ? transform.scale.x : 1,
      scaleY: transform.scale ? transform.scale.y : 1,
      scaleZ: transform.scale ? transform.scale.z : 1,
    };
    overlayCanvas.style.cursor = 'grabbing';
  }

  function updateGizmoDrag(mx, my, cam) {
    if (!draggingAxis || !dragStartMouse || !dragStartValue) return;
    var scene = window.Omosuen && window.Omosuen.getActiveScene && window.Omosuen.getActiveScene();
    if (!scene) return;
    var comp = scene.getComponentById(selectedComponentId, true);
    if (!comp) return;
    var nexus = comp.type === 'nexus' ? comp : comp.parent;
    if (!nexus || !nexus.getComponentByType) return;
    var transform = nexus.getComponentByType('transform');
    if (!transform) return;

    var dx = mx - dragStartMouse.x, dy = my - dragStartMouse.y;

    var dragAv = getAngleValues(cam);
    var dragAxisDirs = getAxisDirs(dragAv);

    if (gizmoMode === 'translate') {
      var dir = dragAxisDirs[draggingAxis];
      var projected = dx*dir.x + dy*dir.y;
      var worldDelta = projected / cam.zoom;
      if (draggingAxis === 'x') transform.position.x = dragStartValue.x + worldDelta;
      else if (draggingAxis === 'y') transform.position.y = dragStartValue.y + worldDelta;
      else transform.position.z = dragStartValue.z + worldDelta;
      sendMessage('component:changed', {
        componentId: nexus.id, property: 'position',
        value: { _vectorType:'Vector3D', x:transform.position.x, y:transform.position.y, z:transform.position.z },
      });
    } else if (gizmoMode === 'rotate') {
      var rotDelta = dx * 0.01;
      if (draggingAxis === 'x') transform.rotation.x = dragStartValue.rotX + rotDelta;
      else if (draggingAxis === 'y') transform.rotation.y = dragStartValue.rotY + rotDelta;
      else transform.rotation.z = dragStartValue.rotZ + rotDelta;
      sendMessage('component:changed', {
        componentId: nexus.id, property: 'rotation',
        value: { _vectorType:'Vector3D', x:transform.rotation.x, y:transform.rotation.y, z:transform.rotation.z },
      });
    } else if (gizmoMode === 'scale') {
      var dir = dragAxisDirs[draggingAxis];
      var projected = dx*dir.x + dy*dir.y;
      var scaleFactor = Math.max(0.01, 1 + projected / 100);
      if (draggingAxis === 'x') transform.scale.x = dragStartValue.scaleX * scaleFactor;
      else if (draggingAxis === 'y') transform.scale.y = dragStartValue.scaleY * scaleFactor;
      else transform.scale.z = dragStartValue.scaleZ * scaleFactor;
      sendMessage('component:changed', {
        componentId: nexus.id, property: 'scale',
        value: { _vectorType:'Vector3D', x:transform.scale.x, y:transform.scale.y, z:transform.scale.z },
      });
    }
  }

  function endGizmoDrag() {
    draggingAxis = null; dragStartMouse = null; dragStartValue = null;
    overlayCanvas.style.cursor = hoveredAxis ? 'pointer' : 'default';
  }

  // ── Grid Overlay ───────────────────────────────────────────────

  function drawGrid(ctx, cam) {
    if (!window.Omosuen || !window.Omosuen.getActiveScene) return;
    var scene = window.Omosuen.getActiveScene();
    if (!scene) return;
    var cellMap = null, mapTransform = null;
    traverseScene(scene, function(nexus, transform) {
      if (cellMap) return;
      if (nexus.getComponentByType) {
        var cm = nexus.getComponentByType('cell-map');
        if (cm) { cellMap = cm; mapTransform = transform; }
      }
    });
    if (!cellMap || !cellMap.cellSize || !cellMap.mapSize) return;
    var ox = mapTransform && mapTransform.position ? mapTransform.position.x : 0;
    var oy = mapTransform && mapTransform.position ? mapTransform.position.y : 0;
    var oz = mapTransform && mapTransform.position ? mapTransform.position.z : 0;
    var cw = cellMap.cellSize.x, cd = cellMap.cellSize.z;
    var cols = cellMap.mapSize.x, rows = cellMap.mapSize.z;

    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 0.5;
    for (var r=0;r<=rows;r++) {
      var s=worldToScreen(ox,oy,oz+r*cd,cam), e=worldToScreen(ox+cols*cw,oy,oz+r*cd,cam);
      ctx.beginPath(); ctx.moveTo(s.x,s.y); ctx.lineTo(e.x,e.y); ctx.stroke();
    }
    for (var c=0;c<=cols;c++) {
      var s=worldToScreen(ox+c*cw,oy,oz,cam), e=worldToScreen(ox+c*cw,oy,oz+rows*cd,cam);
      ctx.beginPath(); ctx.moveTo(s.x,s.y); ctx.lineTo(e.x,e.y); ctx.stroke();
    }
  }

  // ── Message Handling ───────────────────────────────────────────

  function handleMessage(msg) {
    switch(msg.type) {
      case 'component:select':
        selectedComponentId = msg.payload.componentId;
        break;
      case 'component:update':
        handleComponentUpdate(msg.payload);
        break;
      case 'component:add':
      case 'component:instantiate':
        handleComponentAdd(msg.payload);
        break;
      case 'component:remove':
        handleComponentRemove(msg.payload);
        break;
      case 'component:move':
        handleComponentMove(msg.payload);
        break;
      case 'scene:reload':
        window.location.reload();
        break;
      case 'preview:pause':
        if (window.Omosuen && window.Omosuen.pause) {
          window.Omosuen.pause();
          sendMessage('preview:pauseState', { paused: true });
        }
        break;
      case 'preview:resume':
        if (window.Omosuen && window.Omosuen.resume) {
          window.Omosuen.resume();
          sendMessage('preview:pauseState', { paused: false });
        }
        break;
      case 'preview:step':
        if (window.Omosuen && window.Omosuen.resume) {
          window.Omosuen.resume();
          requestAnimationFrame(function() {
            if (window.Omosuen && window.Omosuen.pause) window.Omosuen.pause();
            sendMessage('preview:pauseState', { paused: true });
          });
        }
        break;
      case 'preview:togglePerf':
        togglePerfOverlay();
        break;
      case 'scene:load':
        sendSceneState();
        break;
      case 'gizmo:mode':
        if (msg.payload && msg.payload.mode) gizmoMode = msg.payload.mode;
        break;
      case 'editor:toggleGrid':
        gridVisible = !gridVisible;
        break;
      case 'editor:setCameraState':
        if (msg.payload) {
          var camera = getEditorCamera();
          var camTransform = getCameraTransform(camera);
          if (camTransform && camTransform.position) {
            camTransform.position.x = msg.payload.panX || 0;
            camTransform.position.y = msg.payload.panY || 0;
          }
          if (camera && msg.payload.zoom !== undefined) camera.zoom = msg.payload.zoom;
        }
        break;
    }
  }

  function handleComponentUpdate(payload) {
    if (!window.Omosuen || !window.Omosuen.getActiveScene) return;
    var scene = window.Omosuen.getActiveScene();
    if (!scene) return;
    var comp = scene.getComponentById(payload.componentId, true);
    if (!comp) return;
    setNestedProperty(comp, payload.property, reconstructValue(payload.value));
  }

  function handleComponentAdd(payload) {
    if (!window.Omosuen || !window.Omosuen.getActiveScene) return;
    var scene = window.Omosuen.getActiveScene();
    if (!scene) return;
    var parent = scene.getComponentById(payload.parentId, true);
    if (!parent) return;
    var maxId = { value: -1 };
    var newComp = window.Omosuen.deserializeComponentRecursive(payload.component, maxId);
    if (!newComp) return;
    if (maxId.value >= 0 && window.Omosuen.setComponentCount)
      window.Omosuen.setComponentCount(maxId.value + 1);
    parent.addComponent(newComp);
  }

  function handleComponentRemove(payload) {
    if (!window.Omosuen || !window.Omosuen.getActiveScene) return;
    var scene = window.Omosuen.getActiveScene();
    if (!scene) return;
    var comp = scene.getComponentById(payload.componentId, true);
    if (!comp) return;
    window.Omosuen.markForDisposal(comp);
    if (selectedComponentId === payload.componentId) { selectedComponentId = null; }
  }

  function handleComponentMove(payload) {
    if (!window.Omosuen || !window.Omosuen.getActiveScene) return;
    var scene = window.Omosuen.getActiveScene();
    if (!scene) return;
    var comp = scene.getComponentById(payload.componentId, true);
    if (!comp) return;
    var oldParent = scene.getComponentById(payload.oldParentId, true);
    if (oldParent && oldParent.components) {
      for (var i=0; i<oldParent.components.length; i++) {
        if (oldParent.components[i].id === payload.componentId) {
          oldParent.components.splice(i, 1); break;
        }
      }
    }
    var newParent = scene.getComponentById(payload.newParentId, true);
    if (newParent && newParent.components) {
      var idx = Math.max(0, Math.min(payload.index, newParent.components.length));
      newParent.components.splice(idx, 0, comp);
      comp.parent = newParent;
    }
  }

  function sendSceneState() {
    if (!window.Omosuen) return;
    var getActive = window.Omosuen.getActiveScene;
    var serialize = window.Omosuen.serializeComponentRecursive;
    if (getActive && serialize) {
      var scene = getActive();
      if (scene) sendMessage('scene:state', { scene: serialize(scene) });
    }
  }

  // ── FPS Reporting ──────────────────────────────────────────────

  function startFpsReporting() {
    setInterval(function() {
      if (window.Omosuen && window.Omosuen.getFPS)
        sendMessage('preview:fps', { fps: window.Omosuen.getFPS() });
    }, 2000);
  }

  // ── Performance Overlay ────────────────────────────────────────

  var perfDiv = null;
  var perfVisible = false;
  var perfTimer = null;

  function createPerfOverlay() {
    perfDiv = document.createElement('div');
    perfDiv.id = '__omosuen_perf_overlay';
    perfDiv.style.cssText = 'position:fixed;bottom:8px;left:8px;padding:4px 8px;background:rgba(0,0,0,0.6);color:#0f0;font-family:monospace;font-size:12px;border-radius:3px;pointer-events:none;z-index:99998;display:none;';
    perfDiv.textContent = 'FPS: --';
    document.body.appendChild(perfDiv);
  }

  function togglePerfOverlay() {
    perfVisible = !perfVisible;
    if (perfDiv) perfDiv.style.display = perfVisible ? 'block' : 'none';
    if (perfVisible) startPerfUpdate(); else stopPerfUpdate();
  }

  function startPerfUpdate() {
    stopPerfUpdate();
    perfTimer = setInterval(function() {
      if (!perfDiv || !window.Omosuen) return;
      var parts = [];
      if (window.Omosuen.getFPS) parts.push('FPS: ' + Math.round(window.Omosuen.getFPS()));
      if (window.Omosuen.getInitQueueSize) parts.push('Queue: ' + window.Omosuen.getInitQueueSize());
      perfDiv.textContent = parts.join(' | ') || 'FPS: --';
    }, 500);
  }

  function stopPerfUpdate() {
    if (perfTimer) { clearInterval(perfTimer); perfTimer = null; }
  }

  // ── Editor Camera Controls ─────────────────────────────────────

  var pressedKeys = {};
  var cameraLoopRunning = false;
  var lastCameraTime = 0;
  var PAN_SPEED = 200;

  function getEditorCamera() {
    if (!window.Omosuen || !window.Omosuen.getActiveScene) return null;
    var scene = window.Omosuen.getActiveScene();
    if (!scene) return null;
    return scene.getComponentByType('camera', true);
  }

  function getCameraTransform(camera) {
    if (!camera || !camera.parent) return null;
    if (camera.parent.getComponentByType) return camera.parent.getComponentByType('transform');
    return null;
  }

  function startCameraLoop() {
    if (cameraLoopRunning) return;
    cameraLoopRunning = true;
    lastCameraTime = performance.now();
    requestAnimationFrame(cameraFrame);
  }

  function cameraFrame(now) {
    if (!cameraLoopRunning) return;
    var dt = (now - lastCameraTime) / 1000;
    lastCameraTime = now;
    if (dt > 0.1) dt = 0.1;

    var hasPan = pressedKeys['KeyW'] || pressedKeys['KeyA'] || pressedKeys['KeyS'] || pressedKeys['KeyD'] ||
                 pressedKeys['ArrowUp'] || pressedKeys['ArrowLeft'] || pressedKeys['ArrowDown'] || pressedKeys['ArrowRight'];
    if (hasPan) {
      var camera = getEditorCamera();
      var transform = getCameraTransform(camera);
      if (transform && transform.position) {
        // Horizontal pan: inverse-project screen X offset to world X/Z
        var hDelta = PAN_SPEED * dt / (2 * 0.8660254);
        if (pressedKeys['KeyA'] || pressedKeys['ArrowLeft'])  { transform.position.x -= hDelta; transform.position.z += hDelta; }
        if (pressedKeys['KeyD'] || pressedKeys['ArrowRight']) { transform.position.x += hDelta; transform.position.z -= hDelta; }
        // Vertical pan: changing Y (height) only affects isoY
        if (pressedKeys['KeyW'] || pressedKeys['ArrowUp'])    transform.position.y -= PAN_SPEED * dt;
        if (pressedKeys['KeyS'] || pressedKeys['ArrowDown'])  transform.position.y += PAN_SPEED * dt;
        sendMessage('editor:cameraState', {
          panX: transform.position.x, panY: transform.position.y,
          zoom: camera.zoom !== undefined ? camera.zoom : 1,
        });
      }
    }
    if (Object.keys(pressedKeys).length > 0) requestAnimationFrame(cameraFrame);
    else cameraLoopRunning = false;
  }

  function onKeyDown(e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var code = e.code;

    // Gizmo mode / grid toggle
    if (code === 'KeyT') { gizmoMode = 'translate'; e.preventDefault(); return; }
    if (code === 'KeyR') { gizmoMode = 'rotate'; e.preventDefault(); return; }
    if (code === 'KeyE') { gizmoMode = 'scale'; e.preventDefault(); return; }
    if (code === 'KeyG') { gridVisible = !gridVisible; e.preventDefault(); return; }

    // Camera movement
    if (code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD' ||
        code === 'ArrowUp' || code === 'ArrowLeft' || code === 'ArrowDown' || code === 'ArrowRight') {
      e.preventDefault();
      pressedKeys[code] = true;
      startCameraLoop();
    }
  }

  function onKeyUp(e) { delete pressedKeys[e.code]; }

  function onWheel(e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var camera = getEditorCamera();
    if (!camera) return;
    e.preventDefault();
    var zoom = camera.zoom !== undefined ? camera.zoom : 1;
    zoom = Math.max(0.1, Math.min(10, zoom + (e.deltaY > 0 ? -0.1 : 0.1)));
    camera.zoom = zoom;
    var transform = getCameraTransform(camera);
    sendMessage('editor:cameraState', {
      panX: transform && transform.position ? transform.position.x : 0,
      panY: transform && transform.position ? transform.position.y : 0,
      zoom: zoom,
    });
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('wheel', onWheel, { passive: false });

  // ── Initialize ─────────────────────────────────────────────────

  interceptConsole();
  createOverlayCanvas();
  createPerfOverlay();
  connect();
  startFpsReporting();
  startOverlayLoop();

  originalConsole.info('[Omosuen Editor] Overlay initialized');
})();
`;
}
