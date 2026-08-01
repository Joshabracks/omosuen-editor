/** Workspace-relative path helpers shared by Monaco TS sync (no Monaco import). */

export function normalizeRel(relativePath: string): string {
  return relativePath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

export function stripGlobs(target: string): string {
  return target.replace(/\*/g, '');
}

export function parentDir(relativePath: string): string | null {
  const rel = normalizeRel(relativePath);
  const idx = rel.lastIndexOf('/');
  if (idx <= 0) return null;
  return rel.slice(0, idx);
}

export function normalizePaths(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      out[key] = value.filter((v): v is string => typeof v === 'string');
    } else if (typeof value === 'string') {
      out[key] = [value];
    }
  }
  return out;
}

export function isTypescriptLike(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith('.d.ts') ||
    lower.endsWith('.ts') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.mts') ||
    lower.endsWith('.cts') ||
    lower === 'package.json'
  );
}

/**
 * After stripGlobs, path targets like `node_modules/omosuen/src/*` become a
 * directory (`…/src`). Only paths whose final segment looks like a file should
 * be passed to readTextFile.
 */
export function isLikelyFilePath(relativePath: string): boolean {
  const base = normalizeRel(relativePath).split('/').pop() ?? '';
  return base.includes('.');
}
