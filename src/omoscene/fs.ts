import * as vscode from 'vscode';
import type { OmosceneFile } from './types.js';
import { parse } from './parse.js';
import { stringify } from './stringify.js';

const TEXT_DECODER = new TextDecoder('utf-8');
const TEXT_ENCODER = new TextEncoder();

/**
 * Read a `.omoscene` file from the workspace filesystem and parse it.
 * Throws `OmosceneParseError` if the contents are malformed.
 */
export async function readOmoscene(uri: vscode.Uri): Promise<OmosceneFile> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  const text = TEXT_DECODER.decode(bytes);
  return parse(text);
}

/**
 * Atomically write an `OmosceneFile` to the given URI.
 *
 * The write is staged to `<uri>.tmp` and then renamed into place with
 * `overwrite: true`. This guarantees that either the old contents or the
 * new contents are visible — never a half-written file — on filesystems
 * where rename is atomic.
 *
 * If the rename fails, the staged `.tmp` file is best-effort deleted before
 * the original error is re-thrown. The delete failure is swallowed — the
 * rename error is the one the caller needs to see.
 */
export async function writeOmoscene(
  uri: vscode.Uri,
  file: OmosceneFile,
): Promise<void> {
  const text = stringify(file);
  const bytes = TEXT_ENCODER.encode(text);
  const tmpUri = uri.with({ path: uri.path + '.tmp' });
  await vscode.workspace.fs.writeFile(tmpUri, bytes);
  try {
    await vscode.workspace.fs.rename(tmpUri, uri, { overwrite: true });
  } catch (renameError) {
    try {
      await vscode.workspace.fs.delete(tmpUri, { useTrash: false });
    } catch {
      // Best-effort cleanup; the rename error is what the caller needs.
    }
    throw renameError;
  }
}
