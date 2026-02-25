/**
 * "Omosuen: Create New Project" command.
 * Scaffolds a TypeScript/webpack game project that installs omosuen
 * from GitHub and bundles .omoscene files via raw-loader.
 */

import * as vscode from 'vscode';
import * as https from 'https';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';

// ── GitHub helpers ──────────────────────────────────────────────

interface GitHubRelease {
  tag_name: string;
  name: string;
  prerelease: boolean;
  draft: boolean;
}

interface ReleaseOption {
  tag: string;
  label: string;
}

function httpsGet(url: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'omosuen-editor' } }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode ?? 0, body });
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function fetchReleases(): Promise<ReleaseOption[]> {
  const res = await httpsGet(
    'https://api.github.com/repos/Joshabracks/omosuen/releases'
  );

  if (res.statusCode !== 200) {
    throw new Error(`GitHub API returned ${res.statusCode}`);
  }

  const releases = JSON.parse(res.body) as GitHubRelease[];
  return releases
    .filter((r) => !r.draft)
    .map((r) => ({
      tag: r.tag_name,
      label: r.name || r.tag_name,
    }));
}

// ── Shell helpers ───────────────────────────────────────────────

function runCommand(
  command: string,
  args: string[],
  cwd: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, shell: true }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

// ── File templates ──────────────────────────────────────────────

function packageJson(slug: string, tag: string): string {
  return JSON.stringify(
    {
      name: slug,
      version: '0.0.1',
      private: true,
      type: 'module',
      scripts: {
        build: 'webpack --config webpack.config.js --env mode=production',
        'build:dev':
          'webpack --config webpack.config.js --env mode=development',
        'run:scene':
          'webpack --config webpack.config.js --env mode=development',
      },
      dependencies: {
        omosuen: `github:Joshabracks/omosuen#${tag}`,
      },
      devDependencies: {
        'raw-loader': '^4.0.2',
        'ts-loader': '^9.5.0',
        typescript: '^5.6.0',
        webpack: '^5.95.0',
        'webpack-cli': '^5.1.0',
        '@typescript-eslint/eslint-plugin': '^8.0.0',
        '@typescript-eslint/parser': '^8.0.0',
        eslint: '^9.0.0',
      },
    },
    null,
    2
  );
}

function webpackConfig(slug: string): string {
  return `import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import webpack from 'webpack';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const omosuenPkg = JSON.parse(
  readFileSync(path.resolve(__dirname, 'node_modules/omosuen/package.json'), 'utf-8')
);

export default (env) => {
  const isDev = env.mode === 'development';
  const scenePath = env.scene || './scenes/${slug}.omoscene';

  return {
    mode: isDev ? 'development' : 'production',
    entry: './src/index.ts',
    devtool: isDev ? 'source-map' : false,
    target: 'web',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'bundle.js',
    },
    module: {
      rules: [
        {
          test: /\\.ts$/,
          use: {
            loader: 'ts-loader',
            options: { allowTsInNodeModules: true },
          },
          exclude: /node_modules\\/(?!omosuen)/,
        },
        {
          test: /\\.omoscene$/,
          use: ['raw-loader'],
        },
        {
          test: /\\.(glsl|vs|fs|vert|frag)$/,
          use: ['raw-loader'],
        },
      ],
    },
    resolve: {
      extensions: ['.ts', '.js'],
      alias: {
        'omosuen': path.resolve(__dirname, 'node_modules/omosuen/src/index.ts'),
        '@scene': path.resolve(__dirname, scenePath),
      },
    },
    plugins: [
      new webpack.DefinePlugin({
        __ENGINE_VERSION__: JSON.stringify(omosuenPkg.version),
      }),
    ],
    optimization: {
      minimize: !isDev,
    },
  };
};
`;
}

function tsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2020',
        module: 'ES2020',
        lib: ['ES2020', 'DOM'],
        moduleResolution: 'node',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        sourceMap: true,
        outDir: 'dist',
        resolveJsonModule: true,
        paths: {
          omosuen: ['./node_modules/omosuen/src/index.ts'],
        },
      },
      include: ['src/**/*', 'custom.d.ts'],
      exclude: ['node_modules', 'dist'],
    },
    null,
    2
  );
}

function customDts(): string {
  return `declare module '*.omoscene' {
  const content: string;
  export default content;
}

declare module '@scene' {
  const content: string;
  export default content;
}

declare module '*.frag' {
  const content: string;
  export default content;
}

declare module '*.vert' {
  const content: string;
  export default content;
}
`;
}

function eslintConfig(): string {
  return `module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  env: {
    browser: true,
    es2020: true,
  },
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
  },
};
`;
}

function indexHtml(projectName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${projectName}</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <script src="./dist/bundle.js"></script>
</body>
</html>
`;
}

function styleCss(): string {
  return `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    background-color: #000;
    overflow: hidden;
    width: 100vw;
    height: 100vh;
}
`;
}

function indexTs(): string {
  return `import {
  init, start, registerScene, switchScene,
  deserializeComponentRecursive, serializeComponentRecursive,
  getActiveScene, setComponentCount, markForDisposal,
  pause, resume, getFPS, version,
  Vector2D, Vector3D, Vector4D,
} from 'omosuen';
import sceneRaw from '@scene';

interface OmosceneFile {
  omoscene: number;
  engine: string;
  name: string;
  scene: Record<string, unknown>;
}

const sceneFile: OmosceneFile = JSON.parse(sceneRaw);
const scene = deserializeComponentRecursive(sceneFile.scene);

if (!scene) {
  throw new Error('Failed to deserialize scene');
}

init();
(window as any).Omosuen = {
  getActiveScene, serializeComponentRecursive, deserializeComponentRecursive,
  setComponentCount, markForDisposal, pause, resume, getFPS,
  Vector2D, Vector3D, Vector4D, version,
};
registerScene('main', scene as any);
switchScene('main');
start(60);
`;
}

function gitignore(): string {
  return `node_modules/
dist/
*.log
.DS_Store
Thumbs.db
`;
}

function omosceneFile(projectName: string, engineVersion: string): string {
  return JSON.stringify(
    {
      omoscene: 1,
      engine: engineVersion,
      name: projectName,
      scene: {
        type: 'nexus',
        name: projectName,
        id: 0,
        unique: 0,
        paused: false,
        components: [
          {
            type: 'viewport',
            name: 'MainViewport',
            id: 1,
            unique: 0,
            width: 800,
            height: 600,
            offsetX: 0,
            offsetY: 0,
            backgroundColor: { x: 0.1, y: 0.1, z: 0.15, w: 1.0 },
          },
          {
            type: 'camera',
            name: 'MainCamera',
            id: 2,
            unique: 0,
            zoom: 1.0,
            pixelScale: 2.0,
            axonometricAngle: 30,
            viewportRef: 'MainViewport',
          },
        ],
      },
      editor: {
        camera: { panX: 0, panY: 0, zoom: 1.0 },
        selection: [],
        treeState: {},
        annotations: {},
        bookmarks: [],
      },
    },
    null,
    2
  );
}

// ── Slugify helper ──────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── Command registration ────────────────────────────────────────

export function registerCreateProjectCommand(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('omosuen.createProject', async () => {
      // 1. Prompt for project name
      const projectName = await vscode.window.showInputBox({
        prompt: 'Enter a name for your new Omosuen project',
        placeHolder: 'My Game',
        validateInput: (value) => {
          if (!value.trim()) {
            return 'Project name cannot be empty';
          }
          return null;
        },
      });

      if (!projectName) {
        return;
      }

      // 2. Prompt for save location
      const folderUri = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Select Parent Folder',
        title: 'Choose where to create the project',
      });

      if (!folderUri || folderUri.length === 0) {
        return;
      }

      const parentDir = folderUri[0].fsPath;
      const projectSlug = slugify(projectName);
      const projectDir = path.join(parentDir, projectSlug);

      // Check if directory already exists
      if (fs.existsSync(projectDir)) {
        vscode.window.showErrorMessage(
          `Folder "${projectSlug}" already exists in the selected location.`
        );
        return;
      }

      // 3. Fetch releases from GitHub
      let releases: ReleaseOption[];
      try {
        releases = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Fetching Omosuen releases...',
            cancellable: false,
          },
          () => fetchReleases()
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(
          `Failed to fetch releases: ${message}`
        );
        return;
      }

      if (releases.length === 0) {
        vscode.window.showErrorMessage(
          'No releases found on the Omosuen repository.'
        );
        return;
      }

      // 4. Show QuickPick with versions
      const picked = await vscode.window.showQuickPick(
        releases.map((r) => ({
          label: r.tag,
          description: r.label !== r.tag ? r.label : undefined,
        })),
        {
          placeHolder: 'Select an engine version',
          title: 'Omosuen Engine Version',
        }
      );

      if (!picked) {
        return;
      }

      const tag = picked.label;

      // 5–7. Create project, write templates, install dependencies
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Creating project "${projectName}"...`,
            cancellable: false,
          },
          async (progress) => {
            // Create directories
            progress.report({ message: 'Creating project structure...' });
            fs.mkdirSync(projectDir, { recursive: true });
            fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
            fs.mkdirSync(path.join(projectDir, 'scenes'), {
              recursive: true,
            });
            fs.mkdirSync(path.join(projectDir, 'assets'), {
              recursive: true,
            });

            // Write project configuration files
            progress.report({ message: 'Writing project files...' });
            fs.writeFileSync(
              path.join(projectDir, 'package.json'),
              packageJson(projectSlug, tag)
            );
            fs.writeFileSync(
              path.join(projectDir, 'webpack.config.js'),
              webpackConfig(projectSlug)
            );
            fs.writeFileSync(
              path.join(projectDir, 'tsconfig.json'),
              tsConfig()
            );
            fs.writeFileSync(
              path.join(projectDir, 'custom.d.ts'),
              customDts()
            );
            fs.writeFileSync(
              path.join(projectDir, '.eslintrc.cjs'),
              eslintConfig()
            );
            fs.writeFileSync(
              path.join(projectDir, '.gitignore'),
              gitignore()
            );

            // Write game files
            fs.writeFileSync(
              path.join(projectDir, 'index.html'),
              indexHtml(projectName)
            );
            fs.writeFileSync(
              path.join(projectDir, 'style.css'),
              styleCss()
            );
            fs.writeFileSync(
              path.join(projectDir, 'src', 'index.ts'),
              indexTs()
            );
            fs.writeFileSync(
              path.join(projectDir, 'assets', '.gitkeep'),
              ''
            );
            fs.writeFileSync(
              path.join(projectDir, 'scenes', `${projectSlug}.omoscene`),
              omosceneFile(projectName, tag)
            );

            // Install dependencies
            progress.report({
              message: 'Installing dependencies (this may take a minute)...',
            });
            await runCommand('npm', ['install'], projectDir);
          }
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(
          `Failed to create project: ${message}`
        );
        // Clean up partial directory
        try {
          fs.rmSync(projectDir, { recursive: true, force: true });
        } catch {
          // ignore cleanup errors
        }
        return;
      }

      // 8. Open the new project
      const openChoice = await vscode.window.showInformationMessage(
        `Project "${projectName}" created successfully!`,
        'Open in New Window',
        'Open in Current Window'
      );

      if (openChoice === 'Open in New Window') {
        vscode.commands.executeCommand(
          'vscode.openFolder',
          vscode.Uri.file(projectDir),
          true
        );
      } else if (openChoice === 'Open in Current Window') {
        vscode.commands.executeCommand(
          'vscode.openFolder',
          vscode.Uri.file(projectDir),
          false
        );
      }
    })
  );
}
