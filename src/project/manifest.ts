import { isRecord } from '../protocol';
import {
  PROJECT_MANIFEST_FILENAME,
  type ProjectManifest,
} from './types';

export class ProjectManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectManifestError';
  }
}

export function createDefaultManifest(
  name: string,
  engineVersion: string,
): ProjectManifest {
  return {
    name,
    engineVersion,
    mainScene: 'scenes/main.omoscene',
    preview: {
      port: 9421,
      buildScript: 'build:dev',
      open: 'browser-window',
    },
    desktop: {
      shell: 'electron',
      sidecars: [],
    },
    export: {
      web: { outDir: 'dist/web' },
      desktop: { outDir: 'dist/desktop' },
    },
    plugins: [],
  };
}

export function serializeManifest(manifest: ProjectManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function parseManifest(raw: unknown): ProjectManifest {
  if (typeof raw === 'string') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new ProjectManifestError(`invalid JSON: ${detail}`);
    }
    return parseManifest(parsed);
  }

  if (!isRecord(raw)) {
    throw new ProjectManifestError('manifest must be a JSON object');
  }

  const name = requireNonEmptyString(raw, 'name');
  const engineVersion = requireNonEmptyString(raw, 'engineVersion');
  const mainScene = requireNonEmptyString(raw, 'mainScene');

  if (!isRecord(raw.preview)) {
    throw new ProjectManifestError('manifest.preview must be an object');
  }
  const port = raw.preview.port;
  if (typeof port !== 'number' || !Number.isFinite(port)) {
    throw new ProjectManifestError('manifest.preview.port must be a number');
  }
  const buildScript = requireNonEmptyString(raw.preview, 'buildScript');
  if (raw.preview.open !== 'browser-window') {
    throw new ProjectManifestError(
      'manifest.preview.open must be "browser-window"',
    );
  }

  if (!isRecord(raw.desktop)) {
    throw new ProjectManifestError('manifest.desktop must be an object');
  }
  if (raw.desktop.shell !== 'electron') {
    throw new ProjectManifestError('manifest.desktop.shell must be "electron"');
  }
  if (!Array.isArray(raw.desktop.sidecars)) {
    throw new ProjectManifestError('manifest.desktop.sidecars must be an array');
  }

  if (!isRecord(raw.export) || !isRecord(raw.export.web) || !isRecord(raw.export.desktop)) {
    throw new ProjectManifestError(
      'manifest.export must include web and desktop objects',
    );
  }
  const webOut = requireNonEmptyString(raw.export.web, 'outDir');
  const desktopOut = requireNonEmptyString(raw.export.desktop, 'outDir');

  if (!Array.isArray(raw.plugins)) {
    throw new ProjectManifestError('manifest.plugins must be an array');
  }
  for (const entry of raw.plugins) {
    if (typeof entry !== 'string') {
      throw new ProjectManifestError('manifest.plugins entries must be strings');
    }
  }

  return {
    name,
    engineVersion,
    mainScene,
    preview: {
      port,
      buildScript,
      open: 'browser-window',
    },
    desktop: {
      shell: 'electron',
      sidecars: [...raw.desktop.sidecars],
    },
    export: {
      web: { outDir: webOut },
      desktop: { outDir: desktopOut },
    },
    plugins: raw.plugins as string[],
  };
}

function requireNonEmptyString(
  obj: Record<string, unknown>,
  key: string,
): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProjectManifestError(
      `manifest.${key} must be a non-empty string`,
    );
  }
  return value;
}

export { PROJECT_MANIFEST_FILENAME };
