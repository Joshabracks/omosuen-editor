"use strict";
/**
 * HoverProvider — informative tooltips for Omosuen engine API usage.
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
exports.OmosuenHoverProvider = void 0;
const vscode = __importStar(require("vscode"));
const context_1 = require("./context");
const component_schemas_1 = require("../schema/component-schemas");
const component_crud_1 = require("../commands/component-crud");
// ── Static engine function docs ─────────────────────────────────
const ENGINE_FUNCTION_DOCS = {
    newComponent: [
        '```typescript',
        'newComponent(type: COMPONENT_TYPE, options: ComponentOptions, parent?: NexusT): Promise<ComponentData | null>',
        '```',
        'Creates a new component of the given type with the specified options.',
        'Optionally attaches it to a parent nexus.',
    ].join('\n'),
    switchScene: [
        '```typescript',
        'switchScene(name: string): Promise<NexusT | null>',
        '```',
        'Unloads the current scene and loads the named scene.',
    ].join('\n'),
    loadScene: [
        '```typescript',
        'loadScene(name: string): Promise<NexusT | null>',
        '```',
        'Loads a scene by its registered name.',
    ].join('\n'),
    registerScene: [
        '```typescript',
        'registerScene(name: string, scene: NexusT): void',
        '```',
        'Registers a pre-built scene in the scene registry.',
    ].join('\n'),
    registerSceneModule: [
        '```typescript',
        'registerSceneModule(name: string, modulePath: string): void',
        '```',
        'Registers a lazy-loaded scene module.',
    ].join('\n'),
    registerSceneSerialized: [
        '```typescript',
        'registerSceneSerialized(name: string, filePath: string): void',
        '```',
        'Registers a JSON-serialized scene file.',
    ].join('\n'),
    hasScene: [
        '```typescript',
        'hasScene(name: string): boolean',
        '```',
        'Returns true if a scene with the given name is registered.',
    ].join('\n'),
    listScenes: [
        '```typescript',
        'listScenes(): string[]',
        '```',
        'Returns an array of all registered scene names.',
    ].join('\n'),
    getActiveScene: [
        '```typescript',
        'getActiveScene(): NexusT | null',
        '```',
        'Returns the currently active scene root, or null.',
    ].join('\n'),
    castTo: [
        '```typescript',
        'castTo<T>(component: ComponentData, type: COMPONENT_TYPE): T',
        '```',
        'Casts a component to a specific type for type-safe property access.',
    ].join('\n'),
    registerMethod: [
        '```typescript',
        'registerMethod(name: string, fn: (component: ComponentData) => void): void',
        '```',
        'Registers a named method that can be called on components via their Proxy.',
    ].join('\n'),
    registerBinding: [
        '```typescript',
        'registerBinding(name: string, fn: (event: InputEvent) => void): void',
        '```',
        'Registers a named input binding handler.',
    ].join('\n'),
    registerHtmlConstructor: [
        '```typescript',
        'registerHtmlConstructor(key: string, fn: (overlay: HTMLElement) => void): void',
        '```',
        'Registers an HTML constructor for UI overlays.',
    ].join('\n'),
};
const COMPONENT_TYPE_SET = new Set(component_crud_1.ALL_COMPONENT_TYPES);
// ── Component descriptions ──────────────────────────────────────
const COMPONENT_DESCRIPTIONS = {
    'nexus': 'Container node that holds child components in a hierarchy. The fundamental building block of scene structure.',
    'transform': 'Defines position, rotation, and scale in 3D axonometric space.',
    'sprite': 'Renders a 2D image with texture map references, anchoring, tinting, and silhouette support.',
    'camera': 'Axonometric camera that renders the scene through a viewport. Supports zoom, pixel scale, and reveal effects. **LOCAL unique** — one per parent nexus.',
    'viewport': 'Render target defining screen dimensions, offset, and background color.',
    'collider': 'Physics collision boundary. Can be a box or sphere shape with configurable size and offset.',
    'event-collider': 'Trigger zone for event detection. Same shapes as collider but used for event-based interactions.',
    'light': 'Light source with support for ambient, point, spot, and directional types.',
    'timer': 'Countdown timer with configurable duration, speed, repeat, and auto-destroy.',
    'messenger': 'Event message bus enabling inter-component communication via named listeners.',
    'input-controller': 'Handles keyboard and input binding dispatch with configurable key mappings.',
    'audio-track': 'Audio file reference component. Points to an audio file (MP3, WAV, OGG, etc.). Unique per name within parent.',
    'audio-player': 'Global audio playback engine managing the AudioContext, buffer cache, and active sources. **GLOBAL unique** — one per scene.',
    'audio-effect': 'Audio effect chain with pitch shift, speed shift, reverb, multi-band EQ, volume, stereo pan, and spatial (HRTF) audio.',
    'animation-controller': 'Sprite animation state machine referencing a sprite by ID with play/pause/stop states.',
    'ui-overlay': 'HTML overlay panel constructed via a registered HTML constructor key.',
    'data-layer': 'Persistent key-value data store for game state.',
    'flag-manager': 'Boolean flag registry for tracking game state flags. **GLOBAL unique** — one per scene.',
    'texture-map': 'Texture atlas entry mapping a key to an image file path.',
    'atlas-manager': 'Manages texture atlas packing with configurable atlas size and padding. **GLOBAL unique** — one per scene.',
    'cell-map': 'Tile-based grid map for terrain rendering with cell-level smoothing and reveal support.',
};
// ── Provider ────────────────────────────────────────────────────
class OmosuenHoverProvider {
    constructor(discovery) {
        this.discovery = discovery;
    }
    provideHover(document, position, _token) {
        const ctx = (0, context_1.detectCursorContext)(document, position);
        // 1. Component type strings
        if (ctx.kind === 'newComponent-type' || ctx.kind === 'component-type-arg') {
            const literal = (0, context_1.extractStringLiteralRange)(document, position);
            if (literal && COMPONENT_TYPE_SET.has(literal.value)) {
                return this.componentTypeHover(literal.value, literal.range);
            }
        }
        // 2. Options property names
        if (ctx.kind === 'newComponent-options' && ctx.property) {
            return this.propertyHover(ctx.componentType, ctx.property, document, position);
        }
        // 3. Scene name strings
        if (ctx.kind === 'scene-name') {
            const literal = (0, context_1.extractStringLiteralRange)(document, position);
            if (literal) {
                return this.sceneNameHover(literal.value, literal.range);
            }
        }
        // 4. Engine function names (not inside a string)
        if (ctx.kind === 'none') {
            return this.engineFunctionHover(document, position);
        }
        return null;
    }
    // ── Hover Builders ──────────────────────────────────────────
    componentTypeHover(type, range) {
        const md = new vscode.MarkdownString();
        const desc = COMPONENT_DESCRIPTIONS[type] ?? '';
        md.appendMarkdown(`### \`${type}\` component\n\n`);
        if (desc) {
            md.appendMarkdown(`${desc}\n\n`);
        }
        const schema = component_schemas_1.COMPONENT_SCHEMAS[type];
        const editableProps = schema.filter((p) => !p.readOnly);
        if (editableProps.length > 0) {
            md.appendMarkdown('**Properties:**\n\n');
            md.appendMarkdown('| Name | Type | Default |\n');
            md.appendMarkdown('|------|------|---------|\n');
            for (const prop of editableProps) {
                const def = prop.default !== undefined ? formatDefault(prop.default) : '—';
                md.appendMarkdown(`| \`${prop.name}\` | ${prop.type} | ${def} |\n`);
            }
        }
        return new vscode.Hover(md, range);
    }
    propertyHover(componentType, propertyName, doc, position) {
        const schema = component_schemas_1.COMPONENT_SCHEMAS[componentType];
        const prop = schema.find((p) => p.name === propertyName);
        if (!prop) {
            return null;
        }
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${prop.label}** (\`${prop.name}\`)\n\n`);
        md.appendMarkdown(`Type: \`${prop.type}\`\n\n`);
        if (prop.default !== undefined) {
            md.appendMarkdown(`Default: \`${formatDefault(prop.default)}\`\n\n`);
        }
        if (prop.min !== undefined || prop.max !== undefined) {
            const parts = [];
            if (prop.min !== undefined) {
                parts.push(`min: ${prop.min}`);
            }
            if (prop.max !== undefined) {
                parts.push(`max: ${prop.max}`);
            }
            if (prop.step !== undefined) {
                parts.push(`step: ${prop.step}`);
            }
            md.appendMarkdown(`Range: ${parts.join(', ')}\n\n`);
        }
        if (prop.values) {
            md.appendMarkdown(`Values: ${prop.values.map((v) => `\`'${v}'\``).join(' | ')}\n\n`);
        }
        // Find word range for the property name
        const wordRange = doc.getWordRangeAtPosition(position);
        return new vscode.Hover(md, wordRange);
    }
    sceneNameHover(name, range) {
        const entries = this.discovery.getSceneNames().filter((e) => e.name === name);
        if (entries.length === 0) {
            return null;
        }
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**Scene:** \`${name}\`\n\n`);
        for (const entry of entries) {
            const basename = entry.uri.path.split('/').pop() ?? entry.uri.path;
            md.appendMarkdown(`- Defined in \`${basename}\` (${entry.source})\n`);
        }
        return new vscode.Hover(md, range);
    }
    engineFunctionHover(document, position) {
        const wordRange = document.getWordRangeAtPosition(position, /\b\w+\b/);
        if (!wordRange) {
            return null;
        }
        const word = document.getText(wordRange);
        const doc = ENGINE_FUNCTION_DOCS[word];
        if (!doc) {
            return null;
        }
        return new vscode.Hover(new vscode.MarkdownString(doc), wordRange);
    }
}
exports.OmosuenHoverProvider = OmosuenHoverProvider;
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
//# sourceMappingURL=hover.js.map