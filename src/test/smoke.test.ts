import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  IPC,
  MENU_COMMANDS,
  isIpcChannel,
  isMenuCommandId,
} from '../bridge/channels';

test('IPC catalog includes workspace, fs, and window channels', () => {
  assert.equal(IPC.workspaceGet, 'workspace:get');
  assert.equal(IPC.workspaceChanged, 'workspace:changed');
  assert.equal(IPC.dialogOpenFolder, 'dialog:openFolder');
  assert.equal(IPC.fsList, 'fs:list');
  assert.equal(IPC.fsReadText, 'fs:readText');
  assert.equal(IPC.fsWriteText, 'fs:writeText');
  assert.equal(IPC.windowPopOut, 'window:popOut');
  assert.equal(IPC.windowDragStart, 'window:dragStart');
  assert.equal(IPC.windowDragEnd, 'window:dragEnd');
  assert.equal(IPC.windowCloseAllPopouts, 'window:closeAllPopouts');
  assert.equal(IPC.windowClosed, 'window:closed');
  assert.equal(IPC.shellBusPublish, 'shell:bus:publish');
  assert.equal(isIpcChannel('fs:list'), true);
  assert.equal(isIpcChannel('window:dragStart'), true);
  assert.equal(isIpcChannel('fs:unknown'), false);
  assert.equal(isIpcChannel('window:redock'), false);
});

test('menu command ids are enumerated', () => {
  assert.equal(MENU_COMMANDS.includes('file.openFolder'), true);
  assert.equal(MENU_COMMANDS.includes('view.resetLayout'), true);
  assert.equal(isMenuCommandId('file.openFolder'), true);
  assert.equal(isMenuCommandId('view.resetLayout'), true);
  assert.equal(isMenuCommandId('file.missing'), false);
});
