/**
 * Inspector webview script — renders property editors for the selected component.
 * Communicates with the extension via vscode.postMessage / window.addEventListener('message').
 */

(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  const emptyState = document.getElementById('empty-state');
  const header = document.getElementById('component-header');
  const componentName = document.getElementById('component-name');
  const componentType = document.getElementById('component-type');
  const propertiesContainer = document.getElementById('properties-container');

  let currentComponent = null;
  let currentSchema = [];
  let currentSpriteContext = null;
  let currentCameraContext = null;
  let currentAnimationControllerContext = null;
  let currentCellMapContext = null;
  let currentTextureMapContext = null;

  // ── Message Handling ────────────────────────────────────────────

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.command) {
      case 'showComponent':
        currentComponent = message.component;
        currentSchema = message.schema || [];
        currentSpriteContext = message.spriteContext || null;
        currentCameraContext = message.cameraContext || null;
        currentAnimationControllerContext = message.animationControllerContext || null;
        currentCellMapContext = message.cellMapContext || null;
        currentTextureMapContext = message.textureMapContext || null;
        render();
        break;
      case 'showMultiSelection':
        currentComponent = null;
        currentSchema = [];
        renderMultiSelection(message.count);
        break;
      case 'fileSelected':
        handleFileSelected(message.property, message.value);
        break;
    }
  });

  // ── Rendering ───────────────────────────────────────────────────

  function render() {
    propertiesContainer.innerHTML = '';

    if (!currentComponent) {
      emptyState.style.display = '';
      header.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    header.style.display = '';
    componentName.textContent = currentComponent.name;
    componentType.textContent = currentComponent.type;

    // Always show name and type fields (read-only-ish)
    renderBaseFields();

    // Render validation warnings
    if (currentSpriteContext) {
      renderSpriteWarnings(currentSpriteContext);
    }
    if (currentCameraContext) {
      renderCameraWarnings(currentCameraContext);
    }
    if (currentAnimationControllerContext) {
      renderAnimationControllerWarnings(currentAnimationControllerContext);
    }
    if (currentCellMapContext) {
      renderCellMapInfo(currentCellMapContext);
    }

    // Render schema-driven properties
    for (const schema of currentSchema) {
      renderProperty(propertiesContainer, schema, currentComponent);
    }
  }

  function renderMultiSelection(count) {
    propertiesContainer.innerHTML = '';
    emptyState.style.display = 'none';
    header.style.display = 'none';

    const info = document.createElement('div');
    info.className = 'multi-selection-info';
    info.textContent = count + ' components selected';
    propertiesContainer.appendChild(info);
  }

  function renderBaseFields() {
    // Name field (editable)
    const nameRow = createPropertyRow('Name', 'string');
    const nameInput = nameRow.querySelector('input');
    nameInput.value = currentComponent.name || '';
    nameInput.addEventListener('change', () => {
      sendPropertyChange('name', nameInput.value);
    });
    propertiesContainer.appendChild(nameRow);

    // Type field (read-only)
    const typeRow = createPropertyRow('Type', 'readonly');
    const typeSpan = document.createElement('span');
    typeSpan.textContent = currentComponent.type;
    typeSpan.style.fontSize = '12px';
    typeSpan.style.color = 'var(--vscode-descriptionForeground)';
    typeRow.querySelector('.property-value').appendChild(typeSpan);
    propertiesContainer.appendChild(typeRow);

    // ID field (read-only)
    if (currentComponent.id !== undefined) {
      const idRow = createPropertyRow('ID', 'readonly');
      const idSpan = document.createElement('span');
      idSpan.textContent = String(currentComponent.id);
      idSpan.style.fontSize = '12px';
      idSpan.style.color = 'var(--vscode-descriptionForeground)';
      idRow.querySelector('.property-value').appendChild(idSpan);
      propertiesContainer.appendChild(idRow);
    }
  }

  function renderSpriteWarnings(ctx) {
    if (!ctx.hasSiblingTransform) {
      var w = document.createElement('div');
      w.className = 'inspector-warning';
      w.textContent = 'Missing sibling Transform component';
      propertiesContainer.appendChild(w);
    }

    var tmKeys = currentComponent.textureMapKeys || {};
    var channels = ['albedo', 'normal', 'material', 'emission'];
    var kv = ctx.keyValidation || {};

    for (var i = 0; i < channels.length; i++) {
      var ch = channels[i];
      var key = tmKeys[ch] || '';
      if (ch === 'albedo' && !key) {
        var w2 = document.createElement('div');
        w2.className = 'inspector-warning';
        w2.textContent = 'Albedo texture map key is required';
        propertiesContainer.appendChild(w2);
      } else if (key && kv[ch] && !kv[ch].exists) {
        var w3 = document.createElement('div');
        w3.className = 'inspector-warning';
        w3.textContent = ch.charAt(0).toUpperCase() + ch.slice(1) + " texture map '" + key + "' not found";
        propertiesContainer.appendChild(w3);
      }
    }
  }

  function renderCameraWarnings(ctx) {
    if (!ctx.hasSiblingTransform) {
      var w = document.createElement('div');
      w.className = 'inspector-warning';
      w.textContent = 'Missing sibling Transform component';
      propertiesContainer.appendChild(w);
    }
  }

  function renderAnimationControllerWarnings(ctx) {
    if (!ctx.hasSiblingSprite) {
      var w = document.createElement('div');
      w.className = 'inspector-warning';
      w.textContent = 'Missing sibling Sprite component';
      propertiesContainer.appendChild(w);
    }
  }

  function renderCellMapInfo(ctx) {
    var info = document.createElement('div');
    info.className = 'inspector-warning';
    info.style.color = '#7a7060';
    info.style.background = 'transparent';
    info.style.borderLeftColor = '#2e2518';
    info.textContent = ctx.materialCount + ' materials | Map: ' + ctx.mapDimensions;
    propertiesContainer.appendChild(info);
  }

  function renderProperty(container, schema, data) {
    const value = getNestedValue(data, schema.name);

    switch (schema.type) {
      case 'string':
        container.appendChild(renderStringField(schema, value));
        break;
      case 'number':
        container.appendChild(renderNumberField(schema, value));
        break;
      case 'boolean':
        container.appendChild(renderBooleanField(schema, value));
        break;
      case 'enum':
        container.appendChild(renderEnumField(schema, value));
        break;
      case 'readonly':
        container.appendChild(renderReadonlyField(schema, value));
        break;
      case 'Vector2D':
        container.appendChild(renderVector2DField(schema, value));
        break;
      case 'Vector3D':
        container.appendChild(renderVector3DField(schema, value));
        break;
      case 'Color3':
        container.appendChild(renderColor3Field(schema, value));
        break;
      case 'Color4':
        container.appendChild(renderColor4Field(schema, value));
        break;
      case 'object':
        container.appendChild(renderObjectField(schema, value, data));
        break;
      case 'action':
        container.appendChild(renderActionField(schema));
        break;
      case 'frameList':
        container.appendChild(renderFrameListField(schema, value));
        break;
      case 'filepath':
        container.appendChild(renderFilepathField(schema, value));
        break;
    }
  }

  // ── Field Renderers ─────────────────────────────────────────────

  function renderStringField(schema, value) {
    const row = createPropertyRow(schema.label, 'string');
    const input = row.querySelector('input');
    input.value = value !== undefined ? String(value) : (schema.default || '');
    input.addEventListener('change', () => {
      sendPropertyChange(schema.name, input.value);
    });
    return row;
  }

  function renderNumberField(schema, value) {
    const row = createPropertyRow(schema.label, 'number');
    const input = row.querySelector('input');
    input.value = value !== undefined ? String(value) : String(schema.default || 0);
    if (schema.min !== undefined) input.min = String(schema.min);
    if (schema.max !== undefined) input.max = String(schema.max);
    if (schema.step !== undefined) input.step = String(schema.step);
    input.addEventListener('change', () => {
      sendPropertyChange(schema.name, parseFloat(input.value));
    });
    return row;
  }

  function renderBooleanField(schema, value) {
    const row = createPropertyRow(schema.label, 'boolean');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value !== undefined ? Boolean(value) : Boolean(schema.default);
    input.addEventListener('change', () => {
      sendPropertyChange(schema.name, input.checked);
    });
    row.querySelector('.property-value').appendChild(input);
    return row;
  }

  function renderEnumField(schema, value) {
    const row = document.createElement('div');
    row.className = 'property-row';

    const label = document.createElement('div');
    label.className = 'property-label';
    label.textContent = schema.label;
    row.appendChild(label);

    const valueDiv = document.createElement('div');
    valueDiv.className = 'property-value';

    const select = document.createElement('select');
    select.className = 'enum-select';

    for (const option of (schema.values || [])) {
      const opt = document.createElement('option');
      opt.value = option;
      opt.textContent = option;
      if (value === option || (value === undefined && option === schema.default)) {
        opt.selected = true;
      }
      select.appendChild(opt);
    }

    select.addEventListener('change', () => {
      sendPropertyChange(schema.name, select.value);
    });

    valueDiv.appendChild(select);
    row.appendChild(valueDiv);
    return row;
  }

  function renderReadonlyField(schema, value) {
    const row = createPropertyRow(schema.label, 'readonly');
    const span = document.createElement('span');
    span.style.fontSize = '12px';
    span.style.color = 'var(--vscode-descriptionForeground)';

    if (value === undefined || value === null) {
      span.textContent = schema.default !== undefined ? String(schema.default) : '--';
    } else if (typeof value === 'object') {
      try {
        span.textContent = JSON.stringify(value);
      } catch {
        span.textContent = String(value);
      }
    } else {
      span.textContent = String(value);
    }

    row.querySelector('.property-value').appendChild(span);
    return row;
  }

  function renderVector2DField(schema, value) {
    const row = document.createElement('div');
    row.className = 'property-row';

    const label = document.createElement('div');
    label.className = 'property-label';
    label.textContent = schema.label;
    row.appendChild(label);

    const valueDiv = document.createElement('div');
    valueDiv.className = 'property-value';

    const vectorDiv = document.createElement('div');
    vectorDiv.className = 'vector-input';

    const val = resolveVector(value, schema.default, 2);

    ['x', 'y'].forEach((axis) => {
      const field = document.createElement('div');
      field.className = 'vector-field';

      const lbl = document.createElement('label');
      lbl.textContent = axis.toUpperCase();
      field.appendChild(lbl);

      const input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.value = String(val[axis] || 0);
      input.addEventListener('change', () => {
        val[axis] = parseFloat(input.value);
        sendPropertyChange(schema.name, { _vectorType: 'Vector2D', ...val });
      });
      field.appendChild(input);
      vectorDiv.appendChild(field);
    });

    valueDiv.appendChild(vectorDiv);
    row.appendChild(valueDiv);
    return row;
  }

  function renderVector3DField(schema, value) {
    const row = document.createElement('div');
    row.className = 'property-row';

    const label = document.createElement('div');
    label.className = 'property-label';
    label.textContent = schema.label;
    row.appendChild(label);

    const valueDiv = document.createElement('div');
    valueDiv.className = 'property-value';

    const vectorDiv = document.createElement('div');
    vectorDiv.className = 'vector-input';

    const val = resolveVector(value, schema.default, 3);

    ['x', 'y', 'z'].forEach((axis) => {
      const field = document.createElement('div');
      field.className = 'vector-field';

      const lbl = document.createElement('label');
      lbl.textContent = axis.toUpperCase();
      field.appendChild(lbl);

      const input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.value = String(val[axis] || 0);
      input.addEventListener('change', () => {
        val[axis] = parseFloat(input.value);
        sendPropertyChange(schema.name, { _vectorType: 'Vector3D', ...val });
      });
      field.appendChild(input);
      vectorDiv.appendChild(field);
    });

    valueDiv.appendChild(vectorDiv);
    row.appendChild(valueDiv);
    return row;
  }

  function renderColor3Field(schema, value) {
    const row = document.createElement('div');
    row.className = 'property-row';

    const label = document.createElement('div');
    label.className = 'property-label';
    label.textContent = schema.label;
    row.appendChild(label);

    const valueDiv = document.createElement('div');
    valueDiv.className = 'property-value';

    const colorDiv = document.createElement('div');
    colorDiv.className = 'color-input';

    const val = resolveVector(value, schema.default, 3);
    const hex = rgbToHex(val.x || 0, val.y || 0, val.z || 0);

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = hex;
    colorInput.addEventListener('input', () => {
      const rgb = hexToRgb(colorInput.value);
      sendPropertyChange(schema.name, {
        _vectorType: 'Vector3D',
        x: rgb.r,
        y: rgb.g,
        z: rgb.b,
      });
    });

    colorDiv.appendChild(colorInput);
    valueDiv.appendChild(colorDiv);
    row.appendChild(valueDiv);
    return row;
  }

  function renderColor4Field(schema, value) {
    const row = document.createElement('div');
    row.className = 'property-row';

    const label = document.createElement('div');
    label.className = 'property-label';
    label.textContent = schema.label;
    row.appendChild(label);

    const valueDiv = document.createElement('div');
    valueDiv.className = 'property-value';

    const colorDiv = document.createElement('div');
    colorDiv.className = 'color-input';

    const val = resolveVector(value, schema.default, 4);
    const hex = rgbToHex(val.x || 0, val.y || 0, val.z || 0);

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = hex;
    colorInput.addEventListener('input', () => {
      const rgb = hexToRgb(colorInput.value);
      const alpha = parseFloat(alphaInput.value);
      sendPropertyChange(schema.name, {
        _vectorType: 'Vector4D',
        x: rgb.r,
        y: rgb.g,
        z: rgb.b,
        w: alpha,
      });
    });

    const alphaInput = document.createElement('input');
    alphaInput.type = 'number';
    alphaInput.className = 'alpha-field';
    alphaInput.min = '0';
    alphaInput.max = '1';
    alphaInput.step = '0.01';
    alphaInput.value = String(val.w !== undefined ? val.w : 1);
    alphaInput.title = 'Alpha';
    alphaInput.addEventListener('change', () => {
      const rgb = hexToRgb(colorInput.value);
      sendPropertyChange(schema.name, {
        _vectorType: 'Vector4D',
        x: rgb.r,
        y: rgb.g,
        z: rgb.b,
        w: parseFloat(alphaInput.value),
      });
    });

    colorDiv.appendChild(colorInput);
    colorDiv.appendChild(alphaInput);
    valueDiv.appendChild(colorDiv);
    row.appendChild(valueDiv);
    return row;
  }

  function renderActionField(schema) {
    const row = document.createElement('div');
    row.className = 'property-row';

    const label = document.createElement('div');
    label.className = 'property-label';
    row.appendChild(label);

    const valueDiv = document.createElement('div');
    valueDiv.className = 'property-value';

    const button = document.createElement('button');
    button.className = 'action-button';
    button.textContent = schema.label;
    button.addEventListener('click', () => {
      vscode.postMessage({
        command: 'executeCommand',
        vsCommand: schema.command,
      });
    });

    valueDiv.appendChild(button);
    row.appendChild(valueDiv);
    return row;
  }

  function renderFrameListField(schema, value) {
    const group = document.createElement('div');
    group.className = 'property-group';

    const groupHeader = document.createElement('div');
    groupHeader.className = 'property-group-header';
    group.appendChild(groupHeader);

    // Show mode summary
    if (!value || value === null) {
      groupHeader.textContent = schema.label + ' (Single)';
      return group;
    }
    if (value.mode === 'grid') {
      const cols = value.cols || 1;
      const rows = value.rows || 1;
      groupHeader.textContent = schema.label + ' (Grid ' + cols + '\u00d7' + rows + ')';
      return group;
    }
    if (value.mode !== 'framemap') {
      groupHeader.textContent = schema.label;
      return group;
    }

    // FrameMap mode — collapsible editable list
    const frames = value.frames || [];
    let collapsed = false;

    groupHeader.textContent = schema.label + ' (' + frames.length + ')';
    groupHeader.style.cursor = 'pointer';

    const subContainer = document.createElement('div');
    subContainer.className = 'sub-fields frame-list';
    group.appendChild(subContainer);

    groupHeader.addEventListener('click', () => {
      collapsed = !collapsed;
      subContainer.style.display = collapsed ? 'none' : '';
    });

    function rebuildList() {
      subContainer.innerHTML = '';
      groupHeader.textContent = schema.label + ' (' + frames.length + ')';

      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        const item = document.createElement('div');
        item.className = 'frame-list-item';

        const idx = document.createElement('span');
        idx.className = 'frame-list-idx';
        idx.textContent = String(i);
        item.appendChild(idx);

        const fields = [
          { key: 'x', label: 'X' },
          { key: 'y', label: 'Y' },
          { key: 'w', label: 'W' },
          { key: 'h', label: 'H' },
        ];

        for (const fd of fields) {
          const fieldWrap = document.createElement('div');
          fieldWrap.className = 'vector-field';

          const lbl = document.createElement('label');
          lbl.textContent = fd.label;
          fieldWrap.appendChild(lbl);

          const input = document.createElement('input');
          input.type = 'number';
          input.min = fd.key === 'w' || fd.key === 'h' ? '1' : '0';
          input.step = '1';
          input.value = String(f[fd.key] || 0);
          input.addEventListener('change', ((index, key) => {
            return () => {
              frames[index][key] = parseInt(input.value) || 0;
              emitFrameList();
            };
          })(i, fd.key));
          fieldWrap.appendChild(input);
          item.appendChild(fieldWrap);
        }

        const removeBtn = document.createElement('button');
        removeBtn.className = 'frame-remove-btn';
        removeBtn.textContent = '\ud83d\uddd1';
        removeBtn.title = 'Remove frame';
        removeBtn.addEventListener('click', ((index) => {
          return () => {
            frames.splice(index, 1);
            emitFrameList();
            rebuildList();
          };
        })(i));
        item.appendChild(removeBtn);

        subContainer.appendChild(item);
      }

      // Add button
      const addBtn = document.createElement('button');
      addBtn.className = 'frame-add-btn';
      addBtn.textContent = '+ Add Frame';
      addBtn.addEventListener('click', () => {
        frames.push({ x: 0, y: 0, w: 32, h: 32 });
        emitFrameList();
        rebuildList();
      });
      subContainer.appendChild(addBtn);
    }

    function emitFrameList() {
      sendPropertyChange(schema.name, {
        mode: 'framemap',
        frames: frames.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h })),
      });
    }

    rebuildList();
    return group;
  }

  function renderFilepathField(schema, value) {
    const wrapper = document.createElement('div');

    const row = document.createElement('div');
    row.className = 'property-row';

    const label = document.createElement('div');
    label.className = 'property-label';
    label.textContent = schema.label;
    row.appendChild(label);

    const valueDiv = document.createElement('div');
    valueDiv.className = 'property-value';

    const field = document.createElement('div');
    field.className = 'filepath-field';
    field.dataset.property = schema.name;

    const textSpan = document.createElement('span');
    textSpan.className = 'filepath-text';
    const pathVal = value !== undefined ? String(value) : '';
    if (pathVal) {
      textSpan.textContent = pathVal;
    } else {
      textSpan.textContent = 'Click to select file...';
      textSpan.classList.add('placeholder');
    }
    field.appendChild(textSpan);

    // Trash / clear button (only show if there's a value)
    if (pathVal) {
      const clearBtn = document.createElement('button');
      clearBtn.className = 'filepath-clear';
      clearBtn.textContent = '\u{1F5D1}';
      clearBtn.title = 'Clear file path';
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sendPropertyChange(schema.name, '');
      });
      field.appendChild(clearBtn);
    }

    // Click the field to browse
    field.addEventListener('click', () => {
      vscode.postMessage({
        command: 'browseFile',
        property: schema.name,
        acceptedTypes: schema.acceptedTypes || [],
      });
    });

    valueDiv.appendChild(field);
    row.appendChild(valueDiv);
    wrapper.appendChild(row);

    // File existence warning
    if (pathVal && currentTextureMapContext && !currentTextureMapContext.fileExists) {
      const warning = document.createElement('div');
      warning.className = 'filepath-warning';
      warning.textContent = 'File not found: ' + pathVal;
      wrapper.appendChild(warning);
    }

    return wrapper;
  }

  function renderObjectField(schema, value, parentData) {
    const group = document.createElement('div');
    group.className = 'property-group';

    const groupHeader = document.createElement('div');
    groupHeader.className = 'property-group-header';
    groupHeader.textContent = schema.label;
    group.appendChild(groupHeader);

    if (schema.subFields) {
      const subContainer = document.createElement('div');
      subContainer.className = 'sub-fields';

      // For the sprite 'frame' object, only show configured channels and cap max
      const isFrameField = schema.name === 'frame' && currentSpriteContext;
      const tmKeys = isFrameField ? (currentComponent.textureMapKeys || {}) : null;
      const kv = isFrameField ? (currentSpriteContext.keyValidation || {}) : null;

      for (const subSchema of schema.subFields) {
        // Skip unconfigured channels for frame fields
        if (isFrameField) {
          const channelKey = tmKeys[subSchema.name] || '';
          if (!channelKey) continue;
        }

        const subValue = value ? value[subSchema.name] : undefined;
        const subPropertySchema = {
          ...subSchema,
          name: schema.name + '.' + subSchema.name,
        };

        // Cap frame max to frameCount - 1
        if (isFrameField && subSchema.type === 'number' && kv[subSchema.name]) {
          const fc = kv[subSchema.name].frameCount;
          if (fc > 0) {
            subPropertySchema.max = fc - 1;
          }
        }

        switch (subSchema.type) {
          case 'string':
            subContainer.appendChild(renderStringField(subPropertySchema, subValue));
            break;
          case 'number':
            subContainer.appendChild(renderNumberField(subPropertySchema, subValue));
            break;
          case 'boolean':
            subContainer.appendChild(renderBooleanField(subPropertySchema, subValue));
            break;
          case 'enum':
            subContainer.appendChild(renderEnumField(subPropertySchema, subValue));
            break;
          case 'readonly':
            subContainer.appendChild(renderReadonlyField(subPropertySchema, subValue));
            break;
        }
      }

      group.appendChild(subContainer);
    }

    return group;
  }

  function handleFileSelected(property, value) {
    // Update the filepath field in the DOM
    const field = document.querySelector('.filepath-field[data-property="' + property + '"]');
    if (field) {
      const textSpan = field.querySelector('.filepath-text');
      if (textSpan) {
        textSpan.textContent = value || 'Click to select file...';
        textSpan.classList.toggle('placeholder', !value);
      }
    }
    // Update component data and send property change
    if (currentComponent) {
      currentComponent[property] = value;
    }
    sendPropertyChange(property, value);
  }

  // ── Helpers ─────────────────────────────────────────────────────

  function createPropertyRow(labelText, inputType) {
    const row = document.createElement('div');
    row.className = 'property-row';

    const label = document.createElement('div');
    label.className = 'property-label';
    label.textContent = labelText;
    row.appendChild(label);

    const valueDiv = document.createElement('div');
    valueDiv.className = 'property-value';

    if (inputType === 'string') {
      const input = document.createElement('input');
      input.type = 'text';
      valueDiv.appendChild(input);
    } else if (inputType === 'number') {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      valueDiv.appendChild(input);
    }
    // boolean and readonly handled by caller

    row.appendChild(valueDiv);
    return row;
  }

  function getNestedValue(obj, path) {
    if (!obj || !path) return undefined;
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }
    return current;
  }

  function resolveVector(value, defaultVal, dimensions) {
    const val = value || defaultVal || {};
    return {
      x: val.x || 0,
      y: val.y || 0,
      z: dimensions >= 3 ? (val.z || 0) : undefined,
      w: dimensions >= 4 ? (val.w !== undefined ? val.w : 1) : undefined,
    };
  }

  function sendPropertyChange(property, value) {
    vscode.postMessage({
      command: 'propertyChanged',
      property: property,
      value: value,
    });
  }

  // Color conversion helpers (engine uses 0-1 float range)
  function rgbToHex(r, g, b) {
    const toHex = (v) => {
      const clamped = Math.max(0, Math.min(1, v));
      const hex = Math.round(clamped * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }

  function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return { r: 0, g: 0, b: 0 };
    return {
      r: parseInt(result[1], 16) / 255,
      g: parseInt(result[2], 16) / 255,
      b: parseInt(result[3], 16) / 255,
    };
  }

  // Initial render
  render();
})();
