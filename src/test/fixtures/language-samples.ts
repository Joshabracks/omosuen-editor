/** Shared path → Monaco language-id samples (E15 / 0h–0i). */
export const LANGUAGE_ID_SAMPLES: ReadonlyArray<{
  readonly relativePath: string;
  readonly languageId: string;
}> = [
  { relativePath: 'src/app.ts', languageId: 'typescript' },
  { relativePath: 'game/omo.ts', languageId: 'typescript' },
  { relativePath: 'ui/sst.ts', languageId: 'typescript' },
  { relativePath: 'x.tsx', languageId: 'typescript' },
  { relativePath: 'lib.js', languageId: 'javascript' },
  { relativePath: 'levels/main.omoscene', languageId: 'json' },
  { relativePath: 'prefabs/enemy.omocomp', languageId: 'json' },
  { relativePath: 'package.json', languageId: 'json' },
  { relativePath: 'app.css', languageId: 'css' },
  { relativePath: 'index.html', languageId: 'html' },
  { relativePath: 'notes.xyz', languageId: 'plaintext' },
];
