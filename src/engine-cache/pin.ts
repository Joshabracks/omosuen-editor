import fs from 'node:fs/promises';
import path from 'node:path';
import { isRecord } from '../protocol';
import { atomicWriteFile } from '../fs/atomic-write';
import {
  parseManifest,
  serializeManifest,
} from '../project/manifest';
import { detectProjectManifest } from '../project/scaffold';
import {
  PROJECT_MANIFEST_FILENAME,
  type ProjectManifest,
} from '../project/types';
import { sanitizeEngineVersion } from './paths';

export interface PinEngineVersionResult {
  readonly manifest: ProjectManifest;
  readonly previousVersion: string;
  readonly packageJsonUpdated: boolean;
}

/**
 * Update `omosuen.project.json` engineVersion and package.json github pin.
 */
export async function pinProjectEngineVersion(
  projectDir: string,
  engineVersion: string,
): Promise<PinEngineVersionResult> {
  const version = sanitizeEngineVersion(engineVersion);
  const root = path.resolve(projectDir);
  const existing = await detectProjectManifest(root);
  if (!existing) {
    throw new Error(
      `No ${PROJECT_MANIFEST_FILENAME} in ${root} — open an Omosuen project first`,
    );
  }

  const previousVersion = existing.engineVersion;
  const manifest: ProjectManifest = {
    ...existing,
    engineVersion: version,
  };
  await atomicWriteFile(
    path.join(root, PROJECT_MANIFEST_FILENAME),
    serializeManifest(manifest),
  );

  const packageJsonUpdated = await updatePackageJsonPin(root, version);
  const again = parseManifest(serializeManifest(manifest));
  return {
    manifest: again,
    previousVersion,
    packageJsonUpdated,
  };
}

async function updatePackageJsonPin(
  projectDir: string,
  engineVersion: string,
): Promise<boolean> {
  const pkgPath = path.join(projectDir, 'package.json');
  let raw: string;
  try {
    raw = await fs.readFile(pkgPath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return false;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid package.json: ${detail}`);
  }
  if (!isRecord(parsed)) {
    throw new Error('package.json must be a JSON object');
  }

  const deps = isRecord(parsed.dependencies) ? { ...parsed.dependencies } : {};
  deps.omosuen = `github:Joshabracks/omosuen#${engineVersion}`;
  const next = {
    ...parsed,
    dependencies: deps,
  };
  await atomicWriteFile(pkgPath, `${JSON.stringify(next, null, 2)}\n`);
  return true;
}
