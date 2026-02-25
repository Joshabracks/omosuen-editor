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

  // ── Live Editing Helpers ─────────────────────────────────────────

  /**
   * Reconstruct serialized values into proper engine types.
   * Converts { _vectorType: 'Vector3D', x, y, z } → new Vector3D(x, y, z) etc.
   */
  function reconstructValue(value) {
    if (value === null || value === undefined || typeof value !== 'object') {
      return value;
    }
    if (!window.Omosuen) return value;

    if (value._vectorType === 'Vector2D' && window.Omosuen.Vector2D) {
      return new window.Omosuen.Vector2D(value.x || 0, value.y || 0);
    }
    if (value._vectorType === 'Vector3D' && window.Omosuen.Vector3D) {
      return new window.Omosuen.Vector3D(value.x || 0, value.y || 0, value.z || 0);
    }
    if (value._vectorType === 'Vector4D' && window.Omosuen.Vector4D) {
      return new window.Omosuen.Vector4D(value.x || 0, value.y || 0, value.z || 0, value.w || 0);
    }

    // Plain object — recursively reconstruct sub-values
    if (Array.isArray(value)) return value;
    var result = {};
    for (var key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        result[key] = reconstructValue(value[key]);
      }
    }
    return result;
  }

  /**
   * Set a property on an object using a dotted path.
   * e.g. setNestedProperty(comp, 'textureMapKeys.albedo', 'myTex')
   */
  function setNestedProperty(obj, path, value) {
    var parts = path.split('.');
    var current = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (current[parts[i]] === undefined || current[parts[i]] === null) {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
  }

  // ── Message Handling ──────────────────────────────────────────────

  function handleMessage(msg) {
    switch(msg.type) {
      case 'component:select':
        selectedComponentId = msg.payload.componentId;
        highlightSelected();
        break;

      case 'component:update':
        handleComponentUpdate(msg.payload);
        break;

      case 'component:add':
        handleComponentAdd(msg.payload);
        break;

      case 'component:remove':
        handleComponentRemove(msg.payload);
        break;

      case 'component:move':
        handleComponentMove(msg.payload);
        break;

      case 'component:instantiate':
        handleComponentAdd(msg.payload);
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

  function handleComponentUpdate(payload) {
    if (!window.Omosuen || !window.Omosuen.getActiveScene) return;
    var scene = window.Omosuen.getActiveScene();
    if (!scene) return;

    var comp = scene.getComponentById(payload.componentId, true);
    if (!comp) return;

    var value = reconstructValue(payload.value);
    setNestedProperty(comp, payload.property, value);
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

    // Advance the ID counter past the new component's ID to prevent conflicts
    if (maxId.value >= 0 && window.Omosuen.setComponentCount) {
      window.Omosuen.setComponentCount(maxId.value + 1);
    }

    parent.addComponent(newComp);
  }

  function handleComponentRemove(payload) {
    if (!window.Omosuen || !window.Omosuen.getActiveScene) return;
    var scene = window.Omosuen.getActiveScene();
    if (!scene) return;

    var comp = scene.getComponentById(payload.componentId, true);
    if (!comp) return;

    window.Omosuen.markForDisposal(comp);

    // Clear selection if the removed component was selected
    if (selectedComponentId === payload.componentId) {
      selectedComponentId = null;
      highlightSelected();
    }
  }

  function handleComponentMove(payload) {
    if (!window.Omosuen || !window.Omosuen.getActiveScene) return;
    var scene = window.Omosuen.getActiveScene();
    if (!scene) return;

    var comp = scene.getComponentById(payload.componentId, true);
    if (!comp) return;

    // Remove from old parent's components array (without disposing)
    var oldParent = scene.getComponentById(payload.oldParentId, true);
    if (oldParent && oldParent.components) {
      var oldIdx = -1;
      for (var i = 0; i < oldParent.components.length; i++) {
        if (oldParent.components[i].id === payload.componentId) {
          oldIdx = i;
          break;
        }
      }
      if (oldIdx !== -1) {
        oldParent.components.splice(oldIdx, 1);
      }
    }

    // Insert into new parent's components array at the specified index
    var newParent = scene.getComponentById(payload.newParentId, true);
    if (newParent && newParent.components) {
      var insertIdx = Math.max(0, Math.min(payload.index, newParent.components.length));
      newParent.components.splice(insertIdx, 0, comp);
      comp.parent = newParent;
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
