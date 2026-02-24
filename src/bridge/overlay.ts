/**
 * Editor overlay script — injected into the browser preview.
 * This is a JavaScript string template that runs inside the game's browser window.
 * It establishes a WebSocket connection back to the extension and provides:
 * - Console interception (forwards logs to extension)
 * - Selection highlighting (draws overlay on selected entities)
 * - Click-to-select (sends component:selected on viewport click)
 */

export function getOverlayScript(wsPort: number): string {
  return `
(function() {
  'use strict';

  const PROTOCOL = 'omosuen-editor/v1';
  const WS_URL = 'ws://localhost:${wsPort}/editor';

  let ws = null;
  let reconnectTimer = null;
  let msgCounter = 0;
  let selectedComponentId = null;

  // ── Console Interception ──────────────────────────────────────────

  const originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
  };

  function interceptConsole() {
    ['log', 'info', 'warn', 'error'].forEach(function(level) {
      console[level] = function() {
        // Preserve original console behavior
        originalConsole[level].apply(console, arguments);

        // Forward to extension
        const message = Array.prototype.slice.call(arguments)
          .map(function(arg) {
            if (typeof arg === 'object') {
              try { return JSON.stringify(arg); }
              catch(e) { return String(arg); }
            }
            return String(arg);
          })
          .join(' ');

        // Extract tag if message starts with [TAG]
        let tag = undefined;
        const tagMatch = message.match(/^\\[([^\\]]+)\\]/);
        if (tagMatch) {
          tag = tagMatch[1];
        }

        const logLevel = (level === 'log' || level === 'info') ? 'info' : level;
        sendMessage('preview:log', { level: logLevel, message: message, tag: tag });
      };
    });
  }

  // ── WebSocket Connection ──────────────────────────────────────────

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

        // Send ready message with engine info
        var engineVersion = '0.1.0';
        if (window.Omosuen && window.Omosuen.version) {
          engineVersion = window.Omosuen.version;
        }
        sendMessage('preview:ready', {
          engineVersion: engineVersion,
          contractVersion: 1
        });
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

      ws.onerror = function() {
        // onclose will fire after this
      };
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

  // ── Message Handling ──────────────────────────────────────────────

  function handleMessage(msg) {
    switch(msg.type) {
      case 'component:select':
        selectedComponentId = msg.payload.componentId;
        highlightSelected();
        break;

      case 'scene:reload':
        window.location.reload();
        break;

      case 'preview:pause':
        if (window.Omosuen && window.Omosuen.pause) {
          window.Omosuen.pause();
        }
        break;

      case 'preview:resume':
        if (window.Omosuen && window.Omosuen.resume) {
          window.Omosuen.resume();
        }
        break;

      case 'scene:load':
        // Full scene state requested
        sendSceneState();
        break;
    }
  }

  function sendSceneState() {
    if (!window.Omosuen) return;
    var getActiveScene = window.Omosuen.getActiveScene;
    var serialize = window.Omosuen.serializeComponentRecursive;
    if (getActiveScene && serialize) {
      var scene = getActiveScene();
      if (scene) {
        sendMessage('scene:state', { scene: serialize(scene) });
      }
    }
  }

  // ── Selection Highlight ───────────────────────────────────────────

  var overlayDiv = null;

  function createOverlayElement() {
    overlayDiv = document.createElement('div');
    overlayDiv.id = '__omosuen_editor_overlay';
    overlayDiv.style.cssText = [
      'position: fixed',
      'top: 0',
      'left: 0',
      'width: 100%',
      'height: 100%',
      'pointer-events: none',
      'z-index: 99999',
    ].join(';');
    document.body.appendChild(overlayDiv);
  }

  function highlightSelected() {
    if (!overlayDiv) return;
    // Clear existing highlights
    overlayDiv.innerHTML = '';

    if (selectedComponentId === null) return;

    // For now, show a simple indicator that a component is selected
    // Full spatial highlighting requires camera projection math (Phase 5)
    var indicator = document.createElement('div');
    indicator.style.cssText = [
      'position: fixed',
      'top: 8px',
      'right: 8px',
      'padding: 4px 8px',
      'background: rgba(50, 120, 220, 0.8)',
      'color: white',
      'font-family: monospace',
      'font-size: 11px',
      'border-radius: 3px',
      'pointer-events: none',
    ].join(';');
    indicator.textContent = 'Selected: #' + selectedComponentId;
    overlayDiv.appendChild(indicator);
  }

  // ── FPS Reporting ─────────────────────────────────────────────────

  var fpsInterval = null;

  function startFpsReporting() {
    fpsInterval = setInterval(function() {
      if (window.Omosuen && window.Omosuen.getFPS) {
        sendMessage('preview:fps', { fps: window.Omosuen.getFPS() });
      }
    }, 2000);
  }

  // ── Initialize ────────────────────────────────────────────────────

  interceptConsole();
  createOverlayElement();
  connect();
  startFpsReporting();

  originalConsole.info('[Omosuen Editor] Overlay initialized');
})();
`;
}
