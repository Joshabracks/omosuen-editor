import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('omosuenPrompt', {
  submit: (channel: string, value: string | null): Promise<unknown> =>
    ipcRenderer.invoke(channel, value),
});
