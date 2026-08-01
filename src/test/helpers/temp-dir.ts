import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Create a unique temp directory, run `fn`, then delete the tree.
 * Prefer this over inlined mkdtemp/rm in FS tests (0k harness).
 */
export async function withTempDir<T>(
  prefix: string,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
