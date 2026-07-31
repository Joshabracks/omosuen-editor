/**
 * Dev server — Express static file server + WebSocket bridge.
 * Serves the user's game project files and injects the editor overlay.
 */
import { type EditorMessage } from '../types/protocol';
export declare class OmosuenDevServer {
    private projectRoot;
    private port;
    private app;
    private httpServer;
    private wss;
    private clients;
    private _onMessage;
    constructor(projectRoot: string, port?: number);
    /**
     * Register a callback for messages received from the preview
     */
    onMessage(handler: (msg: EditorMessage) => void): void;
    /**
     * Start the dev server and WebSocket
     */
    start(): Promise<string>;
    /**
     * Send a message to all connected preview clients
     */
    broadcast(type: string, payload: unknown): void;
    /**
     * Stop the dev server
     */
    stop(): Promise<void>;
    get isRunning(): boolean;
    /**
     * Serves an HTML file with the editor overlay script injected before </body>
     */
    private serveInjectedHtml;
}
