/**
 * Renderer-facing modal prompts (sandboxed windows cannot use window.prompt).
 */

import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC, type ChoicePromptRequest, type TextPromptRequest } from '../src/bridge/channels';
import { showChoicePrompt } from './choice-prompt';
import { showTextPrompt } from './text-prompt';

function windowFromEvent(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function registerPromptIpc(): void {
  ipcMain.handle(IPC.dialogPromptText, async (event, raw: unknown) => {
    if (!isRecord(raw)) {
      throw new Error('dialog:promptText requires an options object');
    }
    const title = typeof raw.title === 'string' ? raw.title : '';
    const label = typeof raw.label === 'string' ? raw.label : '';
    if (!title || !label) {
      throw new Error('dialog:promptText requires title and label');
    }
    const request: TextPromptRequest = {
      title,
      label,
      ...(typeof raw.defaultValue === 'string'
        ? { defaultValue: raw.defaultValue }
        : {}),
      ...(typeof raw.okLabel === 'string' ? { okLabel: raw.okLabel } : {}),
    };
    return showTextPrompt(windowFromEvent(event), request);
  });

  ipcMain.handle(IPC.dialogPromptChoice, async (event, raw: unknown) => {
    if (!isRecord(raw)) {
      throw new Error('dialog:promptChoice requires an options object');
    }
    const title = typeof raw.title === 'string' ? raw.title : '';
    const label = typeof raw.label === 'string' ? raw.label : '';
    if (!title || !label) {
      throw new Error('dialog:promptChoice requires title and label');
    }
    if (!Array.isArray(raw.options) || raw.options.length === 0) {
      throw new Error('dialog:promptChoice requires a non-empty options array');
    }
    const options = raw.options.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new Error(`dialog:promptChoice options[${index}] must be an object`);
      }
      const value = typeof entry.value === 'string' ? entry.value : '';
      const optLabel = typeof entry.label === 'string' ? entry.label : value;
      if (!value) {
        throw new Error(`dialog:promptChoice options[${index}] needs value`);
      }
      return { value, label: optLabel || value };
    });
    const request: ChoicePromptRequest = {
      title,
      label,
      options,
      ...(typeof raw.selected === 'string' ? { selected: raw.selected } : {}),
      ...(typeof raw.okLabel === 'string' ? { okLabel: raw.okLabel } : {}),
    };
    return showChoicePrompt(windowFromEvent(event), request);
  });
}
