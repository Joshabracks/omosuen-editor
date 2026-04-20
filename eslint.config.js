import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

const sharedGlobals = {
  // Browser globals
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  performance: 'readonly',
  fetch: 'readonly',
  Headers: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  Image: 'readonly',
  WebSocket: 'readonly',
  // Node.js globals
  process: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  global: 'readonly',
};

export default [
  // Base ESLint recommended rules
  eslint.configs.recommended,

  // TypeScript files
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: sharedGlobals,
    },
    plugins: {
      '@typescript-eslint': tseslint,
      prettier: prettier,
    },
    rules: {
      // TypeScript recommended rules
      ...tseslint.configs['recommended'].rules,

      // Explicit return types on functions
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
        },
      ],

      // No any types - use unknown instead
      '@typescript-eslint/no-explicit-any': 'error',

      // No unused variables (prefix with _ to allow)
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],

      // Naming conventions
      '@typescript-eslint/naming-convention': [
        'warn',
        {
          selector: 'variable',
          filter: { regex: '^[ua]_', match: false },
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
        },
        {
          selector: 'function',
          format: ['camelCase'],
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
      ],

      // Unsafe-* rules stay as warn (per .design/05-implementation-plan.md Phase 0)
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',

      // Block any imports from the archived _old/ editor
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/_old/**', '**/_old'],
              message:
                'Imports from _old/ are forbidden. The archived editor is reference only.',
            },
          ],
        },
      ],

      // Prettier integration
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },

  // Disable rules that conflict with Prettier
  prettierConfig,

  // Per-component silo rule (requirement 1.1)
  {
    files: ['src/component/*/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/_old/**', '**/_old'],
              message: 'Imports from _old/ are forbidden.',
            },
            {
              group: ['../*/**'],
              message:
                'Components must not import from sibling component directories. Each component directory is a self-contained silo.',
            },
          ],
        },
      ],
    },
  },

  // Per-scene silo rule (Q7: specialized editor scenes)
  {
    files: ['src/scene/*/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/_old/**', '**/_old'],
              message: 'Imports from _old/ are forbidden.',
            },
            {
              group: ['../*/**'],
              message:
                'Scenes must not import from sibling scene directories. Each scene directory is a self-contained silo.',
            },
          ],
        },
      ],
    },
  },

  // JavaScript files (esbuild.js, etc.)
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: sharedGlobals,
    },
    plugins: {
      prettier: prettier,
    },
    rules: {
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'prettier/prettier': 'error',
    },
  },

  // Ignore patterns (note: src/test/** is NOT ignored — logic tests live there)
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '**/*.min.js',
      '_old/**',
      'eslint.config.js',
      'esbuild.js',
    ],
  },
];
