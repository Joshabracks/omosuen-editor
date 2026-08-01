import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../fs/atomic-write';
import {
  createDefaultManifest,
  parseManifest,
  serializeManifest,
} from './manifest';
import { slugify } from './slugify';
import {
  gitignoreTemplate,
  indexHtmlTemplate,
  indexTsTemplate,
  packageJsonTemplate,
  readmeTemplate,
  starterSceneTemplate,
} from './templates';
import {
  PROJECT_MANIFEST_FILENAME,
  type ProjectManifest,
  type ScaffoldProjectOptions,
} from './types';

/** Relative paths that must exist after scaffold (E9 + 1c). */
export const SCAFFOLD_REQUIRED_PATHS: readonly string[] = [
  'package.json',
  PROJECT_MANIFEST_FILENAME,
  'index.html',
  'src/index.ts',
  'src/scenes',
  'assets/textures',
  'assets/audio',
  'scenes/main.omoscene',
];

export interface ScaffoldProjectResult {
  readonly projectDir: string;
  readonly slug: string;
  readonly manifest: ProjectManifest;
}

/**
 * Create a new game project directory tree.
 * `projectDir` must not already exist.
 */
export async function scaffoldProject(
  options: ScaffoldProjectOptions,
): Promise<ScaffoldProjectResult> {
  const slug = slugify(options.name);
  const projectDir = path.resolve(options.projectDir);

  try {
    await fs.stat(projectDir);
    throw new Error(`Project folder already exists: ${projectDir}`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
  }

  const manifest = createDefaultManifest(options.name.trim() || slug, options.engineVersion);

  const dirs = [
    projectDir,
    path.join(projectDir, 'src'),
    path.join(projectDir, 'src', 'scenes'),
    path.join(projectDir, 'assets', 'textures'),
    path.join(projectDir, 'assets', 'audio'),
    path.join(projectDir, 'scenes'),
    path.join(projectDir, 'components'),
    path.join(projectDir, 'sidecars'),
    path.join(projectDir, 'backends'),
  ];
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }

  await atomicWriteFile(
    path.join(projectDir, PROJECT_MANIFEST_FILENAME),
    serializeManifest(manifest),
  );
  await atomicWriteFile(
    path.join(projectDir, 'package.json'),
    packageJsonTemplate(slug, options.engineVersion),
  );
  await atomicWriteFile(
    path.join(projectDir, 'index.html'),
    indexHtmlTemplate(manifest.name),
  );
  await atomicWriteFile(
    path.join(projectDir, 'src', 'index.ts'),
    indexTsTemplate(),
  );
  await atomicWriteFile(
    path.join(projectDir, 'scenes', 'main.omoscene'),
    starterSceneTemplate(options.engineVersion),
  );
  await atomicWriteFile(path.join(projectDir, '.gitignore'), gitignoreTemplate());
  await atomicWriteFile(
    path.join(projectDir, 'README.md'),
    readmeTemplate(manifest),
  );
  // Keep empty dirs visible in git / explorers.
  await atomicWriteFile(path.join(projectDir, 'src', 'scenes', '.gitkeep'), '');
  await atomicWriteFile(
    path.join(projectDir, 'assets', 'textures', '.gitkeep'),
    '',
  );
  await atomicWriteFile(path.join(projectDir, 'assets', 'audio', '.gitkeep'), '');
  await atomicWriteFile(path.join(projectDir, 'components', '.gitkeep'), '');
  await atomicWriteFile(path.join(projectDir, 'sidecars', '.gitkeep'), '');
  await atomicWriteFile(path.join(projectDir, 'backends', '.gitkeep'), '');

  return { projectDir, slug, manifest };
}

/** Read + parse manifest at a workspace root, or null if missing. */
export async function detectProjectManifest(
  workspaceRoot: string,
): Promise<ProjectManifest | null> {
  const filePath = path.join(workspaceRoot, PROJECT_MANIFEST_FILENAME);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return parseManifest(raw);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw err;
  }
}
