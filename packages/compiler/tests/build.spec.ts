import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createParla } from '@parlajs/core';
import type { Catalog } from '@parlajs/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { build } from '../src/build.ts';
import type { BuildResult } from '../src/build.ts';

const repo = fileURLToPath(new URL('../../..', import.meta.url));

const app = join(repo, '.tmp', 'build-test', 'app');

function put(file: string, content: unknown): void {
  const path = join(app, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

interface CheckoutMessages {
  title: () => string;
  cart: { items: (params: { count: number }) => string };
  terms: (params: { link: (children: string) => string }) => string;
}

interface CommonMessages {
  greeting: (params: { name: string }) => string;
}

let result: BuildResult;

function setup(): void {
  rmSync(join(repo, '.tmp', 'build-test'), { recursive: true, force: true });
  put('parla.config.json', {
    locales: ['en', 'it', 'de'],
    sourceLocale: 'en',
    namespaces: { checkout: { format: 'mf2', path: 'locales/{locale}/checkout.json' } },
    packages: ['@acme/ui'],
  });
  put('locales/en/checkout.json', {
    title: 'Checkout',
    cart: {
      items: '.input {$count :number}\n.match $count\none {{{$count} item}}\n* {{{$count} items}}',
    },
    total: 'Total {$amount :currency currency=EUR}',
    terms: 'Accept the {#link}terms{/link}',
  });
  put('locales/it/checkout.json', {
    title: 'Cassa',
    cart: {
      items:
        '.input {$count :number}\n.match $count\none {{{$count} articolo}}\n* {{{$count} articoli}}',
    },
    total: 'Totale {$amount :currency currency=EUR} per {$who}',
    extra: 'Not in the source',
  });
  put('node_modules/@acme/ui/package.json', {
    name: '@acme/ui',
    parla: { namespaces: { common: { format: 'icu', path: 'locales/{locale}/common.json' } } },
  });
  put('node_modules/@acme/ui/locales/en/common.json', { greeting: 'Hello {name}!', save: 'Save' });
  put('node_modules/@acme/ui/locales/it/common.json', { greeting: 'Ciao {name}!', save: 'Salva' });
  result = build({ cwd: app });
}

describe(build, () => {
  beforeAll(setup);

  it('writes a catalog, types and one chunk per locale and namespace', () => {
    const out = join(app, 'src/parla');
    const missing = [
      'catalog.js',
      'catalog.d.ts',
      'messages/en/checkout.js',
      'messages/it/common.js',
      'messages/de/common.js',
    ].filter((f) => !existsSync(join(out, f)));
    expect(missing).toStrictEqual([]);
    const chunk = readFileSync(join(out, 'messages/it/checkout.js'), 'utf8');
    expect(chunk).not.toContain('"extra"');
    expect(chunk).toContain('articoli');
    expect(chunk).not.toContain('Checkout');
  });

  it('reports translation problems', () => {
    const codes = result.diagnostics.map(
      (d) => `${d.level}:${d.code}:${d.namespace}:${d.locale}:${d.key ?? ''}`,
    );
    expect(codes).toContain('warning:missing-file:checkout:de:');
    expect(codes).toContain('warning:missing-translation:checkout:it:terms');
    expect(codes).toContain('warning:unknown-key:checkout:it:extra');
    expect(codes).toContain('error:param-mismatch:checkout:it:total');
  });

  it('runs end to end through the core runtime, with fallbacks', async () => {
    const { catalog } = (await import(pathToFileURL(join(app, 'src/parla/catalog.js')).href)) as {
      catalog: Catalog;
    };
    const parla = createParla({ catalog, locale: 'it' });
    const t = (await parla.load('checkout')) as CheckoutMessages;
    expect(t.title()).toBe('Cassa');
    expect(t.cart.items({ count: 1 })).toBe('1 articolo');
    expect(t.cart.items({ count: 4 })).toBe('4 articoli');
    expect(t.terms({ link: (c: string) => `[${c}]` })).toBe('Accept the [terms]');
    await parla.setLocale('de');
    const de = parla.getT('common');
    expect(de).toBeUndefined();
    const common = (await parla.load('common')) as CommonMessages;
    expect(common.greeting({ name: 'Ada' })).toBe('Hello Ada!');
  });

  it('generates types that catch wrong calls', () => {
    const dts = readFileSync(join(app, 'src/parla/catalog.d.ts'), 'utf8');
    expect(dts).toContain('items(params: { count: number }): string;');
    expect(dts).toContain('terms(params: { link: (children: RichNode) => RichNode }): RichNode;');
    expect(dts).toContain('greeting(params: { name: string | number }): string;');
    put(
      'src/usage.ts',
      `import type { Namespaces } from '@parlajs/core';
import './parla/catalog.js';
declare const t: Namespaces['checkout'];
declare const c: Namespaces['common'];
export const ok: string[] = [t.title(), t.cart.items({ count: 2 }), t.total({ amount: 3 }), c.greeting({ name: 'Ada' })];
// @ts-expect-error count must be a number
t.cart.items({ count: 'two' });
// @ts-expect-error count is required
t.cart.items();
// @ts-expect-error no such message
t.nope();
// @ts-expect-error no such namespace
export type Missing = Namespaces['missing'];
`,
    );
    put('tsconfig.json', {
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: 'preserve',
        moduleResolution: 'bundler',
        skipLibCheck: true,
        allowImportingTsExtensions: true,
        types: [],
        paths: { '@parlajs/core': [join(repo, 'packages/core/src/index.ts')] },
      },
      include: ['src'],
    });
    const tsc = join(repo, 'node_modules/.bin/tsc');
    expect(() =>
      execFileSync(tsc, ['-p', join(app, 'tsconfig.json')], { encoding: 'utf8' }),
    ).not.toThrow();
  });
});

describe('types for a package that depends on an adapter only', () => {
  const pkg = join(repo, '.tmp', 'build-test-react');
  const write = (file: string, content: unknown): void => {
    const path = join(pkg, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  };

  it('augments the adapter, so messages are typed and rich text is a ReactNode', () => {
    rmSync(pkg, { recursive: true, force: true });
    write('package.json', {
      name: '@acme/widget',
      peerDependencies: { '@parlajs/react': '*' },
      parla: { namespaces: { widget: { format: 'icu', path: 'locales/{locale}/widget.json' } } },
    });
    write('locales/en/widget.json', { title: 'Widget', terms: 'Read the <link>terms</link>' });
    const built = build({ cwd: pkg, write: 'types' });
    expect(built.config.runtime).toBe('@parlajs/react');
    expect(readFileSync(join(pkg, 'src/parla/catalog.d.ts'), 'utf8')).toContain(
      "declare module '@parlajs/react'",
    );

    write(
      'src/usage.ts',
      `import type { ReactNode } from 'react';
import { useParla, useSuspenseParla } from '@parlajs/react';
import './parla/catalog.js';
const { t } = useSuspenseParla(['widget']);
export const title: string = t.widget.title();
export const terms: ReactNode = t.widget.terms({ link: (children) => children });
// @ts-expect-error a ReactNode is not a number, so the adapter's RichNode reached the types
export const wrong: number = t.widget.terms({ link: (children) => children });
const lazy = useParla(['widget']);
export const ready: string | undefined = lazy.ready ? lazy.t.widget.title() : undefined;
// @ts-expect-error \`t\` is undefined until \`ready\` is checked
lazy.t.widget.title();
// @ts-expect-error the namespace is registered, so an unknown one is rejected
useParla(['widget', 'missing']);
// @ts-expect-error always a list, even for one namespace
useSuspenseParla('widget');
`,
    );
    const reactTypes = join(repo, 'packages/react/node_modules/@types/react');
    write('tsconfig.json', {
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: 'preserve',
        moduleResolution: 'bundler',
        skipLibCheck: true,
        allowImportingTsExtensions: true,
        types: [],
        paths: {
          '@parlajs/core': [join(repo, 'packages/core/src/index.ts')],
          '@parlajs/react': [join(repo, 'packages/react/src/index.ts')],
          react: [join(reactTypes, 'index.d.ts')],
        },
      },
      include: ['src'],
    });
    const tsc = join(repo, 'node_modules/.bin/tsc');
    expect(() =>
      execFileSync(tsc, ['-p', join(pkg, 'tsconfig.json')], { encoding: 'utf8' }),
    ).not.toThrow();
  });
});
