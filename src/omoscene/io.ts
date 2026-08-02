import fs from 'node:fs/promises';
import { atomicWriteFile } from '../fs/atomic-write';
import { parse } from './parse';
import { stringify } from './stringify';
import type { OmosceneFile } from './types';

/** Read and parse a `.omoscene` file from disk. */
export async function readOmosceneFile(
  filePath: string,
): Promise<OmosceneFile> {
  const text = await fs.readFile(filePath, 'utf8');
  return parse(text);
}

/** Atomically write an `OmosceneFile` (temp + rename via `atomicWriteFile`). */
export async function writeOmosceneFile(
  filePath: string,
  file: OmosceneFile,
): Promise<void> {
  await atomicWriteFile(filePath, stringify(file));
}
