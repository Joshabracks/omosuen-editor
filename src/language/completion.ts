/**
 * CompletionItemProvider — contextual code completions for the Omosuen engine API.
 */

import * as vscode from 'vscode';
import { detectCursorContext } from './context';
import type { WorkspaceDiscovery } from './discovery';
import { ALL_COMPONENT_TYPES } from '../commands/component-crud';
import { COMPONENT_SCHEMAS, type PropertySchema } from '../schema/component-schemas';
import type { COMPONENT_TYPE } from '../types/engine';

// ── Component descriptions (short one-liners) ───────────────────

const COMPONENT_DESCRIPTIONS: Partial<Record<COMPONENT_TYPE, string>> = {
  'nexus': 'Container node — holds child components in a hierarchy',
  'transform': 'Position, rotation, and scale in 3D space',
  'sprite': 'Rendered 2D image with texture mapping',
  'camera': 'Axonometric camera for rendering (LOCAL unique)',
  'viewport': 'Render target with dimensions and background',
  'collider': 'Physics collision boundary (box or sphere)',
  'event-collider': 'Trigger zone for event detection (box or sphere)',
  'light': 'Light source (ambient, point, spot, or directional)',
  'timer': 'Countdown timer with duration and repeat',
  'messenger': 'Event message bus for inter-component communication',
  'input-controller': 'Keyboard and input binding handler',
  'audio-manager': 'Global audio system manager (GLOBAL unique)',
  'audio-controller': 'Per-entity audio playback controller',
  'animation-controller': 'Sprite animation state machine',
  'ui-overlay': 'HTML overlay panel for UI elements',
  'data-layer': 'Persistent key-value data store',
  'flag-manager': 'Boolean flag registry (GLOBAL unique)',
  'texture-map': 'Texture atlas entry with file path and key',
  'atlas-manager': 'Texture atlas packer and manager (GLOBAL unique)',
  'cell-map': 'Tile-based grid map for terrain',
};

// ── Provider ────────────────────────────────────────────────────

export class OmosuenCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private discovery: WorkspaceDiscovery) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext
  ): vscode.CompletionItem[] | null {
    const ctx = detectCursorContext(document, position);

    switch (ctx.kind) {
      case 'newComponent-type':
      case 'component-type-arg':
        return this.componentTypeCompletions(ctx.prefix);

      case 'newComponent-options':
        if (ctx.property === null) {
          return this.optionsKeyCompletions(ctx.componentType, ctx.prefix);
        }
        return this.optionsValueCompletions(ctx.componentType, ctx.property, ctx.prefix);

      case 'scene-name':
        return this.sceneNameCompletions(ctx.prefix);

      case 'texture-key':
        return this.textureKeyCompletions(ctx.prefix);

      case 'none':
        return null;
    }
  }

  // ── Completion Builders ─────────────────────────────────────

  private componentTypeCompletions(prefix: string): vscode.CompletionItem[] {
    return ALL_COMPONENT_TYPES
      .filter((type) => type.startsWith(prefix))
      .map((type, i) => {
        const item = new vscode.CompletionItem(type, vscode.CompletionItemKind.EnumMember);
        item.detail = COMPONENT_DESCRIPTIONS[type] ?? type;
        item.sortText = String(i).padStart(2, '0');

        // Build documentation from schema
        const schema = COMPONENT_SCHEMAS[type];
        if (schema.length > 0) {
          const md = new vscode.MarkdownString();
          md.appendMarkdown(`**${type}** component\n\n`);
          md.appendMarkdown('| Property | Type | Default |\n');
          md.appendMarkdown('|----------|------|---------|\n');
          for (const prop of schema) {
            if (prop.readOnly) { continue; }
            const def = prop.default !== undefined ? formatDefault(prop.default) : '—';
            md.appendMarkdown(`| \`${prop.name}\` | ${prop.type} | ${def} |\n`);
          }
          item.documentation = md;
        }

        return item;
      });
  }

  private optionsKeyCompletions(
    componentType: COMPONENT_TYPE,
    prefix: string
  ): vscode.CompletionItem[] {
    const schema = COMPONENT_SCHEMAS[componentType];
    const items: vscode.CompletionItem[] = [];

    // Base ComponentOptions fields
    const baseFields = [
      { name: 'name', type: 'string', label: 'Component name' },
      { name: 'overrideKey', type: 'string', label: 'Override key for method dispatch' },
      { name: 'updateOverride', type: 'string', label: 'Update override method name' },
    ];

    for (const field of baseFields) {
      if (!field.name.startsWith(prefix)) { continue; }
      const item = new vscode.CompletionItem(field.name, vscode.CompletionItemKind.Property);
      item.detail = `${field.type} — ${field.label}`;
      item.insertText = new vscode.SnippetString(`${field.name}: $1`);
      item.sortText = `0_${field.name}`;
      items.push(item);
    }

    // Component-specific properties from schema
    for (const prop of schema) {
      if (prop.readOnly) { continue; }
      if (!prop.name.startsWith(prefix)) { continue; }

      const item = new vscode.CompletionItem(prop.name, vscode.CompletionItemKind.Property);
      const def = prop.default !== undefined ? formatDefault(prop.default) : undefined;
      item.detail = `${prop.type}${def ? ` = ${def}` : ''}`;

      // Smart insert text based on type
      item.insertText = buildPropertySnippet(prop);
      item.sortText = `1_${prop.name}`;
      items.push(item);
    }

    return items;
  }

  private optionsValueCompletions(
    componentType: COMPONENT_TYPE,
    property: string,
    prefix: string
  ): vscode.CompletionItem[] {
    const schema = COMPONENT_SCHEMAS[componentType];
    const prop = schema.find((p) => p.name === property);
    if (!prop) { return []; }

    // Enum values
    if (prop.type === 'enum' && prop.values) {
      return prop.values
        .filter((v) => v.startsWith(prefix))
        .map((v) => {
          const item = new vscode.CompletionItem(v, vscode.CompletionItemKind.Value);
          item.detail = prop.default === v ? '(default)' : undefined;
          return item;
        });
    }

    // Texture key references
    if (property === 'textureMapKey' || property === 'viewportRef') {
      if (property === 'textureMapKey') {
        return this.textureKeyCompletions(prefix);
      }
    }

    return [];
  }

  private sceneNameCompletions(prefix: string): vscode.CompletionItem[] {
    const entries = this.discovery.getSceneNames();
    const seen = new Set<string>();

    return entries
      .filter((e) => e.name.startsWith(prefix) && !seen.has(e.name) && (seen.add(e.name), true))
      .map((e) => {
        const item = new vscode.CompletionItem(e.name, vscode.CompletionItemKind.Value);
        const basename = e.uri.path.split('/').pop() ?? e.uri.path;
        item.detail = `from ${basename}`;
        return item;
      });
  }

  private textureKeyCompletions(prefix: string): vscode.CompletionItem[] {
    const entries = this.discovery.getTextureKeys();
    const seen = new Set<string>();

    return entries
      .filter((e) => e.key.startsWith(prefix) && !seen.has(e.key) && (seen.add(e.key), true))
      .map((e) => {
        const item = new vscode.CompletionItem(e.key, vscode.CompletionItemKind.Value);
        const basename = e.uri.path.split('/').pop() ?? e.uri.path;
        item.detail = `from ${basename}`;
        return item;
      });
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function formatDefault(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if ('x' in obj && 'y' in obj) {
      if ('w' in obj) { return `(${obj.x}, ${obj.y}, ${obj.z}, ${obj.w})`; }
      if ('z' in obj) { return `(${obj.x}, ${obj.y}, ${obj.z})`; }
      return `(${obj.x}, ${obj.y})`;
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function buildPropertySnippet(prop: PropertySchema): vscode.SnippetString {
  if (prop.type === 'enum' && prop.values) {
    const choices = prop.values.join(',');
    return new vscode.SnippetString(`${prop.name}: '\${1|${choices}|}'`);
  }
  if (prop.type === 'boolean') {
    return new vscode.SnippetString(`${prop.name}: \${1|true,false|}`);
  }
  if (prop.type === 'Vector2D') {
    const d = (prop.default as Record<string, number> | undefined) ?? { x: 0, y: 0 };
    return new vscode.SnippetString(
      `${prop.name}: { _vectorType: 'Vector2D', x: \${1:${d.x}}, y: \${2:${d.y}} }`
    );
  }
  if (prop.type === 'Vector3D' || prop.type === 'Color3') {
    const d = (prop.default as Record<string, number> | undefined) ?? { x: 0, y: 0, z: 0 };
    return new vscode.SnippetString(
      `${prop.name}: { _vectorType: 'Vector3D', x: \${1:${d.x}}, y: \${2:${d.y}}, z: \${3:${d.z}} }`
    );
  }
  if (prop.type === 'Color4') {
    const d = (prop.default as Record<string, number> | undefined) ?? { x: 1, y: 1, z: 1, w: 1 };
    return new vscode.SnippetString(
      `${prop.name}: { _vectorType: 'Vector4D', x: \${1:${d.x}}, y: \${2:${d.y}}, z: \${3:${d.z}}, w: \${4:${d.w}} }`
    );
  }
  if (prop.type === 'string') {
    const d = prop.default !== undefined ? String(prop.default) : '';
    return new vscode.SnippetString(`${prop.name}: '\${1:${d}}'`);
  }
  if (prop.type === 'number') {
    const d = prop.default !== undefined ? prop.default : 0;
    return new vscode.SnippetString(`${prop.name}: \${1:${d}}`);
  }
  return new vscode.SnippetString(`${prop.name}: $1`);
}
