import path from 'node:path';

/** Resolve a workspace-relative or absolute path; reject escapes. */
export function resolveWorkspacePath(
  workspaceRoot: string,
  requestPath: string,
): string {
  if (!workspaceRoot) {
    throw new Error('No workspace is open');
  }
  if (typeof requestPath !== 'string' || !requestPath || requestPath.includes('\0')) {
    throw new Error('Invalid path');
  }

  const root = path.resolve(workspaceRoot);
  const absolute = path.isAbsolute(requestPath)
    ? path.resolve(requestPath)
    : path.resolve(root, requestPath);

  const rel = path.relative(root, absolute);
  if (rel === '') {
    return root;
  }
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path is outside workspace: ${requestPath}`);
  }
  return absolute;
}

/** Path relative to workspace root using forward-ish OS separators via path.relative. */
export function toWorkspaceRelative(
  workspaceRoot: string,
  absolutePath: string,
): string {
  const absolute = resolveWorkspacePath(workspaceRoot, absolutePath);
  const root = path.resolve(workspaceRoot);
  if (path.resolve(absolute) === root) {
    return '.';
  }
  return path.relative(root, absolute);
}
