/**
 * Console panel — wraps VS Code OutputChannel to display engine log output.
 */
import type { PreviewLogPayload } from '../types/protocol';
export declare class OmosuenConsole {
    private output;
    constructor();
    /**
     * Handle a preview:log message from the browser
     */
    handleLog(payload: PreviewLogPayload): void;
    /**
     * Log an editor-internal message (not from the preview)
     */
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    /**
     * Show the output channel
     */
    show(): void;
    dispose(): void;
}
