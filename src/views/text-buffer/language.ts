/** Map workspace-relative paths to Monaco language ids (E15 tiers A/B). */
export function languageIdForPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const base = normalized.includes('/')
    ? normalized.slice(normalized.lastIndexOf('/') + 1)
    : normalized;
  const lower = base.toLowerCase();

  // omo.ts / sst.ts and plain TS/JS
  if (
    lower.endsWith('.ts') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.mts') ||
    lower.endsWith('.cts')
  ) {
    return 'typescript';
  }
  if (
    lower.endsWith('.js') ||
    lower.endsWith('.jsx') ||
    lower.endsWith('.mjs') ||
    lower.endsWith('.cjs')
  ) {
    return 'javascript';
  }

  // Scene / component docs → JSON highlighting
  if (
    lower.endsWith('.omoscene') ||
    lower.endsWith('.omocomp') ||
    lower.endsWith('.json') ||
    lower.endsWith('.jsonc')
  ) {
    return 'json';
  }

  if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.less')) {
    return 'css';
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return 'html';
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return 'markdown';
  }
  if (lower.endsWith('.xml') || lower.endsWith('.svg')) {
    return 'xml';
  }
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) {
    return 'yaml';
  }
  if (lower.endsWith('.sh') || lower.endsWith('.bash')) {
    return 'shell';
  }

  return 'plaintext';
}
