import * as monaco from 'monaco-editor';
import {
  javascriptDefaults,
  ModuleKind,
  ModuleResolutionKind,
  ScriptTarget,
  typescriptDefaults,
  type CompilerOptions,
} from 'monaco-editor/languages/features/typescript/register.js';
import {
  isLikelyFilePath,
  isTypescriptLike,
  normalizePaths,
  normalizeRel,
  parentDir,
  stripGlobs,
} from './path-utils';

export type { normalizeRel } from './path-utils';
export { normalizeRel as normalizeWorkspaceRel } from './path-utils';

export interface TypescriptServiceDeps {
  readonly getWorkspaceRoot: () => Promise<string | null>;
  readonly readTextFile: (relativePath: string) => Promise<string>;
  readonly listDir: (
    relativePath?: string,
  ) => Promise<
    ReadonlyArray<{ readonly name: string; readonly kind: string }>
  >;
}

let configured = false;
const extraLibDisposables: monaco.IDisposable[] = [];

/** Configure Monaco's TS/JS language service (0.56 `monaco.typescript` API). */
export function ensureTypescriptLanguageService(): void {
  if (configured) return;
  configured = true;

  const options: CompilerOptions = {
    target: ScriptTarget.ESNext,
    module: ModuleKind.ESNext,
    moduleResolution: ModuleResolutionKind.NodeJs,
    allowNonTsExtensions: true,
    allowJs: true,
    checkJs: false,
    strict: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    // Virtual project root — all models/extraLibs use file:///… relative paths.
    baseUrl: 'file:///',
  };

  typescriptDefaults.setCompilerOptions(options);
  javascriptDefaults.setCompilerOptions(options);

  typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });
  javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });

  typescriptDefaults.setEagerModelSync(true);
  javascriptDefaults.setEagerModelSync(true);
}

/**
 * Refresh compiler paths / extra libs from the open workspace so imports like
 * `omosuen` resolve the same way they do under VS Code + tsconfig paths.
 *
 * Monaco's worker has no real filesystem — only open models and extraLibs exist.
 * We mirror workspace files into a virtual `file:///` tree and set `paths` to
 * absolute virtual URIs that exactly match those extraLib keys.
 */
export async function syncWorkspaceTypescript(
  deps: TypescriptServiceDeps,
): Promise<void> {
  ensureTypescriptLanguageService();
  clearExtraLibs();

  const root = await deps.getWorkspaceRoot();
  if (!root) return;

  const tsconfig = await readJsonSafe(deps, 'tsconfig.json');
  const compilerOptions =
    tsconfig && typeof tsconfig === 'object' && tsconfig !== null
      ? ((tsconfig as { compilerOptions?: Record<string, unknown> })
          .compilerOptions ?? {})
      : {};

  const paths = normalizePaths(compilerOptions.paths);
  const monacoPaths: Record<string, string[]> = {};

  for (const [specifier, targets] of Object.entries(paths)) {
    const resolved: string[] = [];
    for (const target of targets) {
      const rel = normalizeRel(stripGlobs(target));
      if (!rel) continue;
      // Glob targets (e.g. `src/*`) strip to a directory — never readText those.
      if (!isLikelyFilePath(rel)) {
        await loadTypescriptTree(deps, rel);
        if (specifier.includes('*')) {
          resolved.push(`${virtualFileUriString(rel)}/*`);
        }
        continue;
      }
      const uri = virtualFileUriString(rel);
      resolved.push(uri);
      await addWorkspaceFileAsExtraLib(deps, rel);
      const dir = parentDir(rel);
      if (dir) await loadTypescriptTree(deps, dir);
    }
    if (resolved.length > 0) monacoPaths[specifier] = resolved;
  }

  await ensureOmosuenMapping(deps, monacoPaths);

  const options: CompilerOptions = {
    ...typescriptDefaults.getCompilerOptions(),
    moduleResolution: ModuleResolutionKind.NodeJs,
    baseUrl: 'file:///',
    paths: monacoPaths,
  };
  typescriptDefaults.setCompilerOptions(options);
  javascriptDefaults.setCompilerOptions(options);
}

/**
 * URI for an open buffer. Uses a virtual `file:///` root (workspace-relative)
 * so path mappings and package extraLibs share one filesystem namespace.
 *
 * IMPORTANT: Monaco's TS worker derives ScriptKind from the substring after the
 * last `.` in `uri.toString()`. Do not append `#fragment` or `?query`.
 */
export function workspaceFileUri(
  _workspaceRoot: string,
  relativePath: string,
): monaco.Uri {
  return virtualFileUri(relativePath);
}

/** Virtual file URI string for a workspace-relative path. */
export function virtualFileUriString(relativePath: string): string {
  return virtualFileUri(relativePath).toString();
}

function virtualFileUri(relativePath: string): monaco.Uri {
  const rel = normalizeRel(relativePath);
  // Leading slash → file:///src/app.ts (not file://src/app.ts).
  return monaco.Uri.file(`/${rel}`);
}

function clearExtraLibs(): void {
  for (const d of extraLibDisposables.splice(0)) {
    d.dispose();
  }
}

async function ensureOmosuenMapping(
  deps: TypescriptServiceDeps,
  monacoPaths: Record<string, string[]>,
): Promise<void> {
  if (monacoPaths.omosuen?.length) {
    await loadTypescriptTree(deps, 'node_modules/omosuen');
    return;
  }

  const pkg = await readJsonSafe(deps, 'node_modules/omosuen/package.json');
  await addWorkspaceFileAsExtraLib(deps, 'node_modules/omosuen/package.json');

  const candidates = [
    typeof (pkg as { types?: unknown } | null)?.types === 'string'
      ? `node_modules/omosuen/${normalizeRel((pkg as { types: string }).types)}`
      : null,
    typeof (pkg as { typings?: unknown } | null)?.typings === 'string'
      ? `node_modules/omosuen/${normalizeRel((pkg as { typings: string }).typings)}`
      : null,
    'node_modules/omosuen/src/index.ts',
    'node_modules/omosuen/index.d.ts',
    'node_modules/omosuen/dist/index.d.ts',
    'node_modules/omosuen/index.ts',
  ].filter((v): v is string => Boolean(v));

  for (const rel of candidates) {
    if (!isLikelyFilePath(rel)) continue;
    const ok = await addWorkspaceFileAsExtraLib(deps, rel);
    if (!ok) continue;
    monacoPaths.omosuen = [virtualFileUriString(rel)];
    await loadTypescriptTree(deps, 'node_modules/omosuen');
    return;
  }
}

async function loadTypescriptTree(
  deps: TypescriptServiceDeps,
  relativeDir: string,
  depth = 0,
): Promise<void> {
  if (depth > 8) return;
  const dir = normalizeRel(relativeDir);
  let entries: ReadonlyArray<{ readonly name: string; readonly kind: string }>;
  try {
    entries = await deps.listDir(dir || undefined);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git'
    ) {
      continue;
    }
    const child = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      await loadTypescriptTree(deps, child, depth + 1);
      continue;
    }
    if (!isTypescriptLike(entry.name)) continue;
    await addWorkspaceFileAsExtraLib(deps, child);
  }
}

async function addWorkspaceFileAsExtraLib(
  deps: TypescriptServiceDeps,
  relativePath: string,
): Promise<boolean> {
  const rel = normalizeRel(relativePath);
  if (!rel) return false;
  try {
    const content = await deps.readTextFile(rel);
    const filePath = virtualFileUriString(rel);
    if (typescriptDefaults.getExtraLibs()[filePath]) return true;
    extraLibDisposables.push(typescriptDefaults.addExtraLib(content, filePath));
    extraLibDisposables.push(javascriptDefaults.addExtraLib(content, filePath));
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe(
  deps: TypescriptServiceDeps,
  relativePath: string,
): Promise<unknown | null> {
  try {
    const text = await deps.readTextFile(relativePath);
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
