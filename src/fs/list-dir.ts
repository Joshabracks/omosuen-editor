import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_DIR_IGNORE,
  shouldIgnoreDirEntry,
} from './ignore';

export interface DirEntry {
  readonly name: string;
  readonly kind: 'file' | 'directory';
  /** Path relative to the listed directory (just the entry name). */
  readonly relativePath: string;
}

export interface ListDirectoryOptions {
  /** Names to skip. Defaults to node_modules / .git. Pass empty set to list all. */
  readonly ignore?: ReadonlySet<string>;
}

export async function listDirectory(
  absoluteDir: string,
  options?: ListDirectoryOptions,
): Promise<DirEntry[]> {
  const ignore = options?.ignore ?? DEFAULT_DIR_IGNORE;
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  const result: DirEntry[] = [];

  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') continue;
    // Skip our atomic-write temp files
    if (entry.name.startsWith('.') && entry.name.endsWith('.tmp')) continue;
    if (shouldIgnoreDirEntry(entry.name, ignore)) continue;

    let kind: 'file' | 'directory' | null = null;
    if (entry.isDirectory()) kind = 'directory';
    else if (entry.isFile()) kind = 'file';
    else if (entry.isSymbolicLink()) {
      try {
        const st = await fs.stat(path.join(absoluteDir, entry.name));
        kind = st.isDirectory() ? 'directory' : st.isFile() ? 'file' : null;
      } catch {
        kind = null;
      }
    }
    if (!kind) continue;

    result.push({
      name: entry.name,
      kind,
      relativePath: entry.name,
    });
  }

  result.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return result;
}
