import {
  createEmptyOmosceneFile,
  stringify,
} from '../omoscene';
import type { ProjectManifest } from './types';

export function packageJsonTemplate(
  slug: string,
  engineVersion: string,
): string {
  return `${JSON.stringify(
    {
      name: slug,
      version: '0.0.1',
      private: true,
      type: 'module',
      scripts: {
        'build:dev': 'echo build:dev stub — wire bundler in a later phase',
        build: 'echo build stub — wire bundler in a later phase',
      },
      dependencies: {
        omosuen: `github:Joshabracks/omosuen#${engineVersion}`,
      },
    },
    null,
    2,
  )}\n`;
}

export function indexHtmlTemplate(projectName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(projectName)}</title>
  <style>
    html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  </style>
</head>
<body>
  <script type="module" src="./src/index.ts"></script>
</body>
</html>
`;
}

export function indexTsTemplate(): string {
  return `/**
 * Game entry — stub until play-mode / bundler wiring (phase 7+).
 * Pin matches omosuen.project.json engineVersion (engine cache under userData).
 */
console.info('[omosuen] game entry stub');
`;
}

export function starterSceneTemplate(
  engineVersion: string,
  sceneName = 'Main',
): string {
  return stringify(
    createEmptyOmosceneFile({
      name: sceneName,
      engine: engineVersion,
    }),
  );
}

export function gitignoreTemplate(): string {
  return `node_modules/
dist/
.omosuen_editor/
*.log
.DS_Store
Thumbs.db
`;
}

export function readmeTemplate(manifest: ProjectManifest): string {
  return `# ${manifest.name}

Omosuen game project (engine \`${manifest.engineVersion}\`).

- Main scene: \`${manifest.mainScene}\`
- Preview port: \`${String(manifest.preview.port)}\`

Created by Omosuen Editor.
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
