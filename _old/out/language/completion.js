"use strict";
/**
 * CompletionItemProvider — contextual code completions for the Omosuen engine API.
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
exports.OmosuenCompletionProvider = void 0;
const vscode = __importStar(require("vscode"));
const context_1 = require("./context");
const component_crud_1 = require("../commands/component-crud");
const component_schemas_1 = require("../schema/component-schemas");
// ── Component descriptions (short one-liners) ───────────────────
const COMPONENT_DESCRIPTIONS = {
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
    'audio-track': 'Audio file reference (unique per name)',
    'audio-player': 'Global audio playback engine (GLOBAL unique)',
    'audio-effect': 'Audio effect chain (pitch, speed, reverb, EQ, spatial)',
    'animation-controller': 'Sprite animation state machine',
    'ui-overlay': 'HTML overlay panel for UI elements',
    'data-layer': 'Persistent key-value data store',
    'flag-manager': 'Boolean flag registry (GLOBAL unique)',
    'texture-map': 'Texture atlas entry with file path and key',
    'atlas-manager': 'Texture atlas packer and manager (GLOBAL unique)',
    'cell-map': 'Tile-based grid map for terrain',
};
// ── Provider ────────────────────────────────────────────────────
class OmosuenCompletionProvider {
    constructor(discovery) {
        this.discovery = discovery;
    }
    provideCompletionItems(document, position, _token, _context) {
        const ctx = (0, context_1.detectCursorContext)(document, position);
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
    componentTypeCompletions(prefix) {
        return component_crud_1.ALL_COMPONENT_TYPES
            .filter((type) => type.startsWith(prefix))
            .map((type, i) => {
            const item = new vscode.CompletionItem(type, vscode.CompletionItemKind.EnumMember);
            item.detail = COMPONENT_DESCRIPTIONS[type] ?? type;
            item.sortText = String(i).padStart(2, '0');
            // Build documentation from schema
            const schema = component_schemas_1.COMPONENT_SCHEMAS[type];
            if (schema.length > 0) {
                const md = new vscode.MarkdownString();
                md.appendMarkdown(`**${type}** component\n\n`);
                md.appendMarkdown('| Property | Type | Default |\n');
                md.appendMarkdown('|----------|------|---------|\n');
                for (const prop of schema) {
                    if (prop.readOnly) {
                        continue;
                    }
                    const def = prop.default !== undefined ? formatDefault(prop.default) : '—';
                    md.appendMarkdown(`| \`${prop.name}\` | ${prop.type} | ${def} |\n`);
                }
                item.documentation = md;
            }
            return item;
        });
    }
    optionsKeyCompletions(componentType, prefix) {
        const schema = component_schemas_1.COMPONENT_SCHEMAS[componentType];
        const items = [];
        // Base ComponentOptions fields
        const baseFields = [
            { name: 'name', type: 'string', label: 'Component name' },
            { name: 'overrideKey', type: 'string', label: 'Override key for method dispatch' },
            { name: 'updateOverride', type: 'string', label: 'Update override method name' },
        ];
        for (const field of baseFields) {
            if (!field.name.startsWith(prefix)) {
                continue;
            }
            const item = new vscode.CompletionItem(field.name, vscode.CompletionItemKind.Property);
            item.detail = `${field.type} — ${field.label}`;
            item.insertText = new vscode.SnippetString(`${field.name}: $1`);
            item.sortText = `0_${field.name}`;
            items.push(item);
        }
        // Component-specific properties from schema
        for (const prop of schema) {
            if (prop.readOnly) {
                continue;
            }
            if (!prop.name.startsWith(prefix)) {
                continue;
            }
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
    optionsValueCompletions(componentType, property, prefix) {
        const schema = component_schemas_1.COMPONENT_SCHEMAS[componentType];
        const prop = schema.find((p) => p.name === property);
        if (!prop) {
            return [];
        }
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
    sceneNameCompletions(prefix) {
        const entries = this.discovery.getSceneNames();
        const seen = new Set();
        return entries
            .filter((e) => e.name.startsWith(prefix) && !seen.has(e.name) && (seen.add(e.name), true))
            .map((e) => {
            const item = new vscode.CompletionItem(e.name, vscode.CompletionItemKind.Value);
            const basename = e.uri.path.split('/').pop() ?? e.uri.path;
            item.detail = `from ${basename}`;
            return item;
        });
    }
    textureKeyCompletions(prefix) {
        const entries = this.discovery.getTextureKeys();
        const seen = new Set();
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
exports.OmosuenCompletionProvider = OmosuenCompletionProvider;
// ── Helpers ─────────────────────────────────────────────────────
function formatDefault(value) {
    if (typeof value === 'object' && value !== null) {
        const obj = value;
        if ('x' in obj && 'y' in obj) {
            if ('w' in obj) {
                return `(${obj.x}, ${obj.y}, ${obj.z}, ${obj.w})`;
            }
            if ('z' in obj) {
                return `(${obj.x}, ${obj.y}, ${obj.z})`;
            }
            return `(${obj.x}, ${obj.y})`;
        }
        return JSON.stringify(value);
    }
    return String(value);
}
function buildPropertySnippet(prop) {
    if (prop.type === 'enum' && prop.values) {
        const choices = prop.values.join(',');
        return new vscode.SnippetString(`${prop.name}: '\${1|${choices}|}'`);
    }
    if (prop.type === 'boolean') {
        return new vscode.SnippetString(`${prop.name}: \${1|true,false|}`);
    }
    if (prop.type === 'Vector2D') {
        const d = prop.default ?? { x: 0, y: 0 };
        return new vscode.SnippetString(`${prop.name}: { _vectorType: 'Vector2D', x: \${1:${d.x}}, y: \${2:${d.y}} }`);
    }
    if (prop.type === 'Vector3D' || prop.type === 'Color3') {
        const d = prop.default ?? { x: 0, y: 0, z: 0 };
        return new vscode.SnippetString(`${prop.name}: { _vectorType: 'Vector3D', x: \${1:${d.x}}, y: \${2:${d.y}}, z: \${3:${d.z}} }`);
    }
    if (prop.type === 'Color4') {
        const d = prop.default ?? { x: 1, y: 1, z: 1, w: 1 };
        return new vscode.SnippetString(`${prop.name}: { _vectorType: 'Vector4D', x: \${1:${d.x}}, y: \${2:${d.y}}, z: \${3:${d.z}}, w: \${4:${d.w}} }`);
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
//# sourceMappingURL=completion.js.map