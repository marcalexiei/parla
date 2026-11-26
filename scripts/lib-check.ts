#!/usr/bin/env node
/**
 * @file Type-checks a throwaway app against the built packages with `skipLibCheck: false`, under
 * `bundler` and `nodenext` resolution. Run `pnpm run build:packages` first.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { build as Build } from '../packages/compiler/src/index.ts';

const repo = join(import.meta.dirname, '..');
const app = join(repo, '.tmp', 'lib-check');
const PACKAGES = ['core', 'react', 'compiler', 'format-icu', 'format-mf2'];

const missing = PACKAGES.filter(
  (p) => !existsSync(join(repo, 'packages', p, 'build', 'index.d.ts')),
);
if (missing.length > 0) {
  console.error(
    `lib-check: no build for ${missing.join(', ')}; run \`pnpm run build:packages\` first`,
  );
  process.exit(1);
}

function write(file: string, content: unknown): void {
  const path = join(app, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`,
  );
}

function link(name: string, target: string): void {
  const path = join(app, 'node_modules', name);
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, 'junction');
}

rmSync(app, { recursive: true, force: true });

// What an app installs: parla, and the peers its types name (react, vite).
for (const p of PACKAGES) {
  link(`@parlajs/${p}`, join(repo, 'packages', p));
}
for (const [peer, from] of [
  ['react', 'react'],
  ['@types/react', 'react'],
  ['vite', 'compiler'],
] as const) {
  const { resolve } = createRequire(join(repo, 'packages', from, 'package.json'));
  link(peer, dirname(resolve(`${peer}/package.json`)));
}

write('package.json', {
  name: 'lib-check',
  private: true,
  type: 'module',
  dependencies: { '@parlajs/react': '*' },
  parla: {
    locales: ['en', 'it'],
    outDir: 'src/parla',
    functions: { capitalize: 'string' },
    markup: ['strong'],
    namespaces: { app: { format: 'icu', path: 'locales/{locale}/app.json' } },
  },
});
const messages = {
  hi: 'Hi {name, capitalize}',
  bold: 'A <strong>bold</strong> move',
  link: 'Read the <link>terms</link>',
  items: '{count, plural, one {# item} other {# items}}',
  when: 'On {d, date, short}',
  pick: '{g, select, a {A} other {B}}',
};
write('locales/en/app.json', messages);
write('locales/it/app.json', messages);
write(
  'src/usage.tsx',
  `import { build, compileMessage } from '@parlajs/compiler';
import { parla as parlaPlugin } from '@parlajs/compiler/vite';
import { createRuntime } from '@parlajs/core';
import { icu } from '@parlajs/format-icu';
import { mf2 } from '@parlajs/format-mf2';
import { createParla, ParlaProvider, useLocale, useParla } from '@parlajs/react';
import type { FunctionName, Locale, MarkupName, MessageFunction, Namespace, Translations } from '@parlajs/react';
import type { ReactNode } from 'react';
import type { Plugin } from 'vite';

import { catalog } from './parla/catalog.js';

export const plugin: Plugin = parlaPlugin();
export const tools = [build, compileMessage, createRuntime, icu, mf2];
const functions: Record<FunctionName, MessageFunction> = { capitalize: (value) => String(value) };
const markup: Record<MarkupName, (children: ReactNode) => ReactNode> = { strong: (children) => children };
export const parla = createParla({ catalog, functions, markup });
export const locale: Locale = 'it';
export const namespace: Namespace = 'app';
export function App(): ReactNode {
  const { t } = useParla(['app']);
  const { setLocale } = useLocale();
  void setLocale('en');
  return [
    t.app.hi({ name: 'ada' }),
    t.app.bold(),
    t.app.link({ link: (children) => children }),
    t.app.items({ count: 2 }),
    t.app.when({ d: new Date() }),
    t.app.pick({ g: 'a' }),
  ];
}
export function Child({ t }: { t: Translations<'app'> }): ReactNode {
  return t.app.bold();
}
export const Provider = ParlaProvider;
`,
);

// The built compiler, as an app runs it
const { build } = (await import(
  pathToFileURL(join(repo, 'packages/compiler/build/index.js')).href
)) as { build: typeof Build };
const built = build({ cwd: app });
if (built.diagnostics.length > 0) {
  console.error('lib-check: the fixture catalog has diagnostics', built.diagnostics);
  process.exit(1);
}

const tsc = join(repo, 'node_modules/.bin/tsc');
let failed = false;
for (const [module, moduleResolution] of [
  ['preserve', 'bundler'],
  ['nodenext', 'nodenext'],
] as const) {
  write('tsconfig.json', {
    compilerOptions: {
      strict: true,
      skipLibCheck: false,
      noEmit: true,
      jsx: 'react-jsx',
      target: 'es2022',
      lib: ['es2023', 'dom'],
      module,
      moduleResolution,
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
      noPropertyAccessFromIndexSignature: true,
      noImplicitOverride: true,
      verbatimModuleSyntax: true,
      types: [],
    },
    include: ['src'],
  });
  const { status, stdout } = spawnSync(tsc, ['-p', join(app, 'tsconfig.json')], {
    encoding: 'utf8',
  });
  console.log(`lib-check ${moduleResolution}: ${status === 0 ? 'ok' : 'FAILED'}`);
  if (status !== 0) {
    console.error(stdout);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
