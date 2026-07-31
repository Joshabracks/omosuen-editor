/** Flat JSON settings document (userData/settings.json). */
export type SettingsData = Record<string, unknown>;

export function parseSettingsJson(raw: string): SettingsData {
  if (!raw.trim()) return {};
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('settings.json must be a JSON object');
  }
  return parsed as SettingsData;
}

export function stringifySettings(data: SettingsData): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function getSettingValue(data: SettingsData, key: string): unknown {
  return data[key];
}

export function setSettingValue(
  data: SettingsData,
  key: string,
  value: unknown,
): SettingsData {
  return { ...data, [key]: value };
}
