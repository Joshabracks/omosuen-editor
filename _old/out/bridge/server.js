"use strict";
/**
 * Dev server — Express static file server + WebSocket bridge.
 * Serves the user's game project files and injects the editor overlay.
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OmosuenDevServer = void 0;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const express_1 = __importDefault(require("express"));
const ws_1 = require("ws");
const console_overlay_1 = require("./console-overlay");
const protocol_1 = require("../types/protocol");
class OmosuenDevServer {
    constructor(projectRoot, port = 9421) {
        this.projectRoot = projectRoot;
        this.port = port;
        this.app = null;
        this.httpServer = null;
        this.wss = null;
        this.clients = new Set();
        this._onMessage = null;
    }
    /**
     * Register a callback for messages received from the preview
     */
    onMessage(handler) {
        this._onMessage = handler;
    }
    /**
     * Start the dev server and WebSocket
     */
    async start() {
        this.app = (0, express_1.default)();
        // Serve the editor overlay script
        this.app.get('/__omosuen_editor_overlay.js', (_req, res) => {
            res.type('application/javascript');
            res.send((0, console_overlay_1.getConsoleOverlayScript)(this.port));
        });
        // Serve the omosuen shim module for dynamic script imports
        this.app.get('/__omosuen_module.js', (_req, res) => {
            res.type('application/javascript');
            res.send(getOmosuenShimScript());
        });
        // Serve index.html with overlay injection
        this.app.get('/', (req, res, next) => {
            this.serveInjectedHtml(req, res, next, 'index.html');
        });
        this.app.get('/index.html', (req, res, next) => {
            this.serveInjectedHtml(req, res, next, 'index.html');
        });
        // Serve all other project files statically
        this.app.use(express_1.default.static(this.projectRoot, {
            setHeaders: (res, filePath) => {
                if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
                    res.setHeader('Content-Type', 'application/javascript');
                }
                if (filePath.endsWith('.wasm')) {
                    res.setHeader('Content-Type', 'application/wasm');
                }
            },
        }));
        // Start HTTP server
        this.httpServer = this.app.listen(this.port);
        // Start WebSocket server
        this.wss = new ws_1.WebSocketServer({
            server: this.httpServer,
            path: '/editor',
        });
        this.wss.on('connection', (ws) => {
            this.clients.add(ws);
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if ((0, protocol_1.isEditorMessage)(msg) && this._onMessage) {
                        this._onMessage(msg);
                    }
                }
                catch {
                    // Ignore malformed messages
                }
            });
            ws.on('close', () => {
                this.clients.delete(ws);
            });
        });
        const url = `http://localhost:${this.port}`;
        return url;
    }
    /**
     * Send a message to all connected preview clients
     */
    broadcast(type, payload) {
        const msg = (0, protocol_1.createMessage)(type, payload);
        const data = JSON.stringify(msg);
        for (const client of this.clients) {
            if (client.readyState === ws_1.WebSocket.OPEN) {
                client.send(data);
            }
        }
    }
    /**
     * Stop the dev server
     */
    async stop() {
        for (const client of this.clients) {
            client.close();
        }
        this.clients.clear();
        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }
        if (this.httpServer) {
            await new Promise((resolve) => {
                this.httpServer.close(() => resolve());
            });
            this.httpServer = null;
        }
        this.app = null;
    }
    get isRunning() {
        return this.httpServer !== null;
    }
    /**
     * Serves an HTML file with the editor overlay script injected before </body>
     */
    serveInjectedHtml(_req, res, next, filename) {
        const filePath = path.join(this.projectRoot, filename);
        if (!fs.existsSync(filePath)) {
            next();
            return;
        }
        let html = fs.readFileSync(filePath, 'utf8');
        // Import map so dynamically-loaded .omo.js scripts can use
        // bare "omosuen" specifiers (type-only imports that survive compilation)
        const importMap = '<script type="importmap">{"imports":{"omosuen":"/__omosuen_module.js"}}</script>';
        if (html.includes('</head>')) {
            html = html.replace('</head>', `${importMap}\n</head>`);
        }
        const overlayTag = '<script src="/__omosuen_editor_overlay.js"></script>';
        if (html.includes('</body>')) {
            html = html.replace('</body>', `${overlayTag}\n</body>`);
        }
        else {
            html += `\n${overlayTag}`;
        }
        res.type('text/html').send(html);
    }
}
exports.OmosuenDevServer = OmosuenDevServer;
/**
 * Returns an ES module that re-exports omosuen runtime values
 * from the globalThis bridge set by the engine's init().
 */
function getOmosuenShimScript() {
    const names = [
        'Vector2D', 'Vector3D', 'Vector4D',
        'Array2D', 'Array3D', 'Array3Dc', 'Array3Di', 'Array3Dic',
        'lerp', 'ComponentUnique', 'ALL_MESSAGES', 'ANY_MESSAGES',
        'createDefaultCellData', 'packCell', 'unpackCell',
    ];
    const lines = names.map((n) => `export const ${n} = e.${n};`);
    return `const e = globalThis.__omosuen_exports;\n${lines.join('\n')}\n`;
}
//# sourceMappingURL=server.js.map