/**
 * Console panel — wraps VS Code OutputChannel to display engine log output.
 */

import * as vscode from 'vscode';
import type { PreviewLogPayload } from '../types/protocol';

export class OmosuenConsole {
  private output: vscode.LogOutputChannel;

  constructor() {
    this.output = vscode.window.createOutputChannel('Omosuen', { log: true });
  }

  /**
   * Handle a preview:log message from the browser
   */
  handleLog(payload: PreviewLogPayload): void {
    const prefix = payload.tag ? `[${payload.tag}] ` : '';
    const text = `${prefix}${payload.message}`;

    switch (payload.level) {
      case 'error':
        this.output.error(text);
        break;
      case 'warn':
        this.output.warn(text);
        break;
      default:
        this.output.info(text);
        break;
    }
  }

  /**
   * Log an editor-internal message (not from the preview)
   */
  info(message: string): void {
    this.output.info(`[Editor] ${message}`);
  }

  warn(message: string): void {
    this.output.warn(`[Editor] ${message}`);
  }

  error(message: string): void {
    this.output.error(`[Editor] ${message}`);
  }

  /**
   * Show the output channel
   */
  show(): void {
    this.output.show(true);
  }

  dispose(): void {
    this.output.dispose();
  }
}
