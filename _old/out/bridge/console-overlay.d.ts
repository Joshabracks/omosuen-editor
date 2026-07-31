/**
 * Console-only overlay script — injected into the browser scene preview.
 * Provides: console interception (with dedup), WebSocket bridge,
 * pause/resume/step controls, FPS reporting, and performance overlay.
 *
 * No editor tools (no canvas overlay, gizmo, click-to-select, grid, or camera controls).
 */
export declare function getConsoleOverlayScript(wsPort: number): string;
