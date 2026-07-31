/**
 * Preview commands — build with webpack, then launch dev server + browser.
 */
import * as vscode from 'vscode';
import { OmosuenDevServer } from '../bridge/server';
import { OmosuenConsole } from '../panels/console';
import type { EditorMessage } from '../types/protocol';
/**
 * Returns the current dev server instance (if running)
 */
export declare function getDevServer(): OmosuenDevServer | null;
/**
 * Register preview commands
 */
export declare function registerPreviewCommands(context: vscode.ExtensionContext, console: OmosuenConsole, onMessage: (msg: EditorMessage) => void): void;
