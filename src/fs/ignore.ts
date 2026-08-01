/** Directory/file names skipped by default when listing a workspace. */
export const DEFAULT_DIR_IGNORE: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
]);

export function shouldIgnoreDirEntry(
  name: string,
  ignore: ReadonlySet<string> = DEFAULT_DIR_IGNORE,
): boolean {
  return ignore.has(name);
}
