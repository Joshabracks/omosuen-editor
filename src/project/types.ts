/** `omosuen.project.json` shape (design §5.2 / E9 / E14). */

export interface ProjectPreviewConfig {
  readonly port: number;
  readonly buildScript: string;
  readonly open: 'browser-window';
}

export interface ProjectDesktopConfig {
  readonly shell: 'electron';
  /** Sidecar entries — empty until 8c. */
  readonly sidecars: readonly unknown[];
}

export interface ProjectExportConfig {
  readonly web: { readonly outDir: string };
  readonly desktop: { readonly outDir: string };
}

export interface ProjectManifest {
  readonly name: string;
  readonly engineVersion: string;
  readonly mainScene: string;
  readonly preview: ProjectPreviewConfig;
  readonly desktop: ProjectDesktopConfig;
  readonly export: ProjectExportConfig;
  readonly plugins: readonly string[];
}

export interface ScaffoldProjectOptions {
  /** Absolute path of the new project root (already includes slug folder). */
  readonly projectDir: string;
  readonly name: string;
  readonly engineVersion: string;
}

export const PROJECT_MANIFEST_FILENAME = 'omosuen.project.json';
