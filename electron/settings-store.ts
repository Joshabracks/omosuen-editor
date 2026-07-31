import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getSettingValue,
  parseSettingsJson,
  setSettingValue,
  stringifySettings,
  type SettingsData,
} from '../src/state/settings';

export class SettingsStore {
  private data: SettingsData = {};
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath =
      filePath ?? path.join(app.getPath('userData'), 'settings.json');
  }

  get path(): string {
    return this.filePath;
  }

  async load(): Promise<SettingsData> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.data = parseSettingsJson(raw);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
      this.data = {};
    }
    return this.data;
  }

  async get(key: string): Promise<unknown> {
    return getSettingValue(this.data, key);
  }

  async set(key: string, value: unknown): Promise<unknown> {
    this.data = setSettingValue(this.data, key, value);
    await this.save();
    return getSettingValue(this.data, key);
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, stringifySettings(this.data), 'utf8');
  }
}
