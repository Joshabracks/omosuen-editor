"use strict";
/**
 * Console-only overlay script — injected into the browser scene preview.
 * Provides: console interception (with dedup), WebSocket bridge,
 * pause/resume/step controls, FPS reporting, and performance overlay.
 *
 * No editor tools (no canvas overlay, gizmo, click-to-select, grid, or camera controls).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConsoleOverlayScript = getConsoleOverlayScript;
function getConsoleOverlayScript(wsPort) {
    return `
(function() {
  'use strict';

  var PROTOCOL = 'omosuen-editor/v1';
  var WS_URL = 'ws://localhost:${wsPort}/editor';

  // ── State ──────────────────────────────────────────────────────
  var ws = null;
  var reconnectTimer = null;
  var msgCounter = 0;

  // ── Console Interception ───────────────────────────────────────

  var originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
  };

  var recentMessages = {};
  var DEDUP_WINDOW = 2000;

  function safeStringify(val, depth) {
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (typeof val === 'string') return val;
    if (typeof val !== 'object') return String(val);
    if (depth <= 0) return '{...}';
    var seen = [];
    function ser(v, d) {
      if (v === null) return 'null';
      if (v === undefined) return 'undefined';
      if (typeof v !== 'object') return JSON.stringify(v);
      if (d <= 0) return '{...}';
      if (seen.indexOf(v) !== -1) return '[Circular]';
      seen.push(v);
      if (Array.isArray(v)) {
        return '[' + v.map(function(i) { return ser(i, d - 1); }).join(', ') + ']';
      }
      var keys;
      try { keys = Object.keys(v); } catch(e) { return String(v); }
      var parts = keys.map(function(k) {
        var pval;
        try { pval = v[k]; } catch(e) { return JSON.stringify(k) + ': [error]'; }
        return JSON.stringify(k) + ': ' + ser(pval, d - 1);
      });
      return '{' + parts.join(', ') + '}';
    }
    return ser(val, depth);
  }

  function interceptConsole() {
    ['log', 'info', 'warn', 'error'].forEach(function(level) {
      console[level] = function() {
        originalConsole[level].apply(console, arguments);
        var message = Array.prototype.slice.call(arguments)
          .map(function(arg) {
            return safeStringify(arg, 3);
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
      id: 'preview_' + Date.now() + '_' + (msgCounter++),
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

  // ── Message Handling ───────────────────────────────────────────

  function handleMessage(msg) {
    switch(msg.type) {
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

  // ── Initialize ─────────────────────────────────────────────────

  interceptConsole();
  createPerfOverlay();
  connect();
  startFpsReporting();

  originalConsole.info('[Omosuen Editor] Console overlay initialized');
})();
`;
}
//# sourceMappingURL=console-overlay.js.map