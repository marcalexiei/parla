import { baseConfig } from '@marcalexiei/oxlint-config/base';
import { nodeConfig } from '@marcalexiei/oxlint-config/node';
import { reactConfig } from '@marcalexiei/oxlint-config/react';
import { typescriptConfig } from '@marcalexiei/oxlint-config/typescript';
import { vitestConfig } from '@marcalexiei/oxlint-config/vitest';
import { defineConfig } from 'oxlint';

export default defineConfig({
  extends: [baseConfig, typescriptConfig],

  // `jsdoc` is off by default; only the tags this repo actually writes are checked.
  plugins: ['eslint', 'import', 'unicorn', 'typescript', 'jsdoc'],

  env: {
    browser: true,
    node: true,
  },

  options: {
    reportUnusedDisableDirectives: 'error',
    typeAware: true,
  },

  rules: {
    'jsdoc/check-tag-names': 'error',
    'jsdoc/empty-tags': 'error',
    'jsdoc/no-blank-blocks': 'error',

    // ---------------------------------------------------------------------------
    // Tuned to what this repository is
    // ---------------------------------------------------------------------------

    // Generated code names params `p` and the runtime `$`; the runtime and compiler mirror those, and
    // comparator pairs, loop indexes and the discarded argument are single letters by convention.
    'id-length': [
      'error',
      {
        checkGeneric: false,
        exceptions: [
          '_',
          '$',
          'a',
          'b',
          'c',
          'd',
          'f',
          'g',
          'i',
          'j',
          'k',
          'l',
          'm',
          'n',
          'p',
          'r',
          's',
          't',
          'v',
          'x',
        ],
        properties: 'never',
      },
    ],

    // `path` is already the name of what these functions take, so the module is imported by member.
    'unicorn/import-style': [
      'error',
      { extendDefaultStyles: true, styles: { 'node:path': { named: true } } },
    ],

    // A required parameter still has to be passed, so an explicit `undefined` argument is not useless.
    'unicorn/no-useless-undefined': ['error', { checkArguments: false }],

    // ---------------------------------------------------------------------------
    // Off, each for a reason this repository owns
    // ---------------------------------------------------------------------------

    // A module exports next to what it defines, so its shape reads top to bottom.
    'import/exports-last': 'off',

    // The code generator builds JS source line by line, which reads better skipping than nesting.
    'no-continue': 'off',

    // Size limits the compiler's code generator already exceeds; splitting it is its own change.
    complexity: 'off',
    'max-depth': 'off',
    'max-lines': 'off',
    'max-lines-per-function': 'off',
    'max-params': 'off',
    'max-statements': 'off',
  },

  overrides: [
    {
      files: ['**/*.{spec,test}.{ts,tsx}'],
      ...vitestConfig,
      // Enabling `jest` alongside `vitest` reports every shared rule twice.
      plugins: ['vitest'],
      rules: {
        ...vitestConfig.rules,
        // A compile spec asserts every case a message format covers.
        'vitest/max-expects': 'off',
        // The rule counts the `?.` and `??` that `noUncheckedIndexedAccess` forces.
        'vitest/no-conditional-in-test': 'off',
      },
    },
    {
      files: ['packages/react/**/*.tsx', 'packages/react/src/**'],
      ...reactConfig,
    },
    {
      // What ships never reaches into its tests.
      files: ['packages/*/src/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/tests/**'],
                message: 'Test helpers are for tests; move what src needs into src.',
              },
              {
                group: ['vitest', 'vitest/*', '@testing-library/*'],
                message: 'A test library is a dev dependency, absent wherever src runs.',
              },
            ],
          },
        ],
      },
    },
    {
      // The runtime runs in browsers too, so it reads no Node globals.
      files: ['packages/core/src/**', 'packages/react/src/**', 'packages/format-*/src/**'],
      rules: {
        'no-restricted-globals': ['error', 'process', 'window', 'document', 'navigator'],
      },
    },
    {
      // Only these run on Node alone; the runtime also runs in the browser.
      files: ['**/*.config.ts', 'scripts/**', 'packages/compiler/src/**'],
      ...nodeConfig,
    },
    {
      // A library must still load through `require(esm)`, which top-level await breaks; the CLI is an entry point.
      files: ['packages/*/src/**'],
      excludeFiles: ['packages/compiler/src/cli.ts'],
      plugins: ['node'],
      rules: {
        'node/no-top-level-await': 'error',
      },
    },
    {
      // The CLI and the scripts report to the terminal; that is their output,
      // and a script that fails says so with an exit code.
      files: ['scripts/**', 'packages/compiler/src/cli.ts'],
      rules: {
        'no-console': 'off',
        'unicorn/no-process-exit': 'off',
      },
    },
    {
      // An ambient declaration file states a module's shape; it imports nothing itself.
      files: ['**/*.d.ts'],
      rules: {
        'import/unambiguous': 'off',
      },
    },
  ],
});
