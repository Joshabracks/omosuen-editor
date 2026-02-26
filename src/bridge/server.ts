/**
 * Dev server — Express static file server + WebSocket bridge.
 * Serves the user's game project files and injects the editor overlay.
 */

import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { getConsoleOverlayScript } from './console-overlay';
import {
  type EditorMessage,
  isEditorMessage,
  createMessage,
  PROTOCOL_VERSION,
} from '../types/protocol';

export class OmosuenDevServer {
  private app: express.Application | null = null;
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private _onMessage: ((msg: EditorMessage) => void) | null = null;

  constructor(
    private projectRoot: string,
    private port: number = 9421
  ) {}

  /**
   * Register a callback for messages received from the preview
   */
  onMessage(handler: (msg: EditorMessage) => void): void {
    this._onMessage = handler;
  }

  /**
   * Start the dev server and WebSocket
   */
  async start(): Promise<string> {
    this.app = express();

    // Serve the editor overlay script
    this.app.get('/__omosuen_editor_overlay.js', (_req, res) => {
      res.type('application/javascript');
      res.send(getConsoleOverlayScript(this.port));
    });

    // Serve index.html with overlay injection
    this.app.get('/', (req, res, next) => {
      this.serveInjectedHtml(req, res, next, 'index.html');
    });

    this.app.get('/index.html', (req, res, next) => {
      this.serveInjectedHtml(req, res, next, 'index.html');
    });

    // Serve all other project files statically
    this.app.use(
      express.static(this.projectRoot, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
            res.setHeader('Content-Type', 'application/javascript');
          }
          if (filePath.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm');
          }
        },
      })
    );

    // Start HTTP server
    this.httpServer = this.app.listen(this.port);

    // Start WebSocket server
    this.wss = new WebSocketServer({
      server: this.httpServer,
      path: '/editor',
    });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (isEditorMessage(msg) && this._onMessage) {
            this._onMessage(msg);
          }
        } catch {
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
  broadcast(type: string, payload: unknown): void {
    const msg = createMessage(type as EditorMessage['type'], payload);
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /**
   * Stop the dev server
   */
  async stop(): Promise<void> {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    this.app = null;
  }

  get isRunning(): boolean {
    return this.httpServer !== null;
  }

  /**
   * Serves an HTML file with the editor overlay script injected before </body>
   */
  private serveInjectedHtml(
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
    filename: string
  ): void {
    const filePath = path.join(this.projectRoot, filename);
    if (!fs.existsSync(filePath)) {
      next();
      return;
    }

    let html = fs.readFileSync(filePath, 'utf8');

    const overlayTag =
      '<script src="/__omosuen_editor_overlay.js"></script>';
    if (html.includes('</body>')) {
      html = html.replace('</body>', `${overlayTag}\n</body>`);
    } else {
      html += `\n${overlayTag}`;
    }

    res.type('text/html').send(html);
  }
}
