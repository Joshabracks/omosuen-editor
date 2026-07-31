import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Write file contents atomically (temp file in the same directory + rename).
 * On Windows, replaces an existing destination via unlink-then-rename.
 */
export async function atomicWriteFile(
  filePath: string,
  contents: string | Buffer,
): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}-${Date.now()}.tmp`,
  );

  try {
    await fs.writeFile(tempPath, contents);
    try {
      await fs.rename(tempPath, filePath);
    } catch {
      await fs.rm(filePath, { force: true });
      await fs.rename(tempPath, filePath);
    }
  } catch (err) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw err;
  }
}
