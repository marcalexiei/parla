import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createParla } from '@parlajs/core';
import type { Catalog } from '@parlajs/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { build } from '../src/build.ts';
import type { BuildResult } from '../src/build.ts';

/** A `parla.config.ts` exporting `config`. */
const configModule = (config: object): string =>
  `export default ${JSON.stringify(config, null, 2)};\n`;

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

async function setup(): Promise<void> {
  rmSync(join(repo, '.tmp', 'build-test'), { recursive: true, force: true });
  put(
    'parla.config.ts',
    configModule({
      locales: ['en', 'it', 'de'],
      sourceLocale: 'en',
      namespaces: { checkout: { format: 'mf2', path: 'locales/{locale}/checkout.json' } },
      packages: ['@acme/ui'],
    }),
  );
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
  result = await build({ cwd: app });
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

  it('writes one types file per namespace, which catalog.d.ts imports, and removes stale ones', async () => {
    const out = join(app, 'src/parla');
    expect(readdirSync(join(out, 'types')).toSorted()).toStrictEqual([
      'checkout.d.ts',
      'common.d.ts',
    ]);
    const catalog = readFileSync(join(out, 'catalog.d.ts'), 'utf8');
    expect(catalog).toContain(
      'import type { CheckoutMessages } from "./types/checkout.js";\nexport type { CheckoutMessages } from "./types/checkout.js";',
    );
    expect(catalog).not.toContain('interface CheckoutMessages');
    writeFileSync(join(out, 'types/removed.d.ts'), 'a namespace since removed');
    await build({ cwd: app, write: 'types' });
    expect(readdirSync(join(out, 'types')).toSorted()).toStrictEqual([
      'checkout.d.ts',
      'common.d.ts',
    ]);
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
    const italian = await parla.load(['checkout']);
    const t = italian['checkout'] as CheckoutMessages;
    expect(t.title()).toBe('Cassa');
    expect(t.cart.items({ count: 1 })).toBe('1 articolo');
    expect(t.cart.items({ count: 4 })).toBe('4 articoli');
    expect(t.terms({ link: (c: string) => `[${c}]` })).toBe('Accept the [terms]');
    await parla.setLocale('de');
    const de = await parla.load(['common']);
    const common = de['common'] as CommonMessages;
    expect(common.greeting({ name: 'Ada' })).toBe('Hello Ada!');
  });

  it('generates types that catch wrong calls', () => {
    const dts = readFileSync(join(app, 'src/parla/types/checkout.d.ts'), 'utf8');
    expect(dts).toContain('items(params: { count: number }): string;');
    expect(dts).toContain('terms(params: { link: (children: Node) => Node }): Node;');
    expect(readFileSync(join(app, 'src/parla/types/common.d.ts'), 'utf8')).toContain(
      'greeting(params: { name: string | number }): string;',
    );
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
        skipLibCheck: false,
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

  it('augments the adapter, so messages are typed and rich text is a ReactNode', async () => {
    rmSync(pkg, { recursive: true, force: true });
    write('package.json', {
      name: '@acme/widget',
      peerDependencies: { '@parlajs/react': '*' },
      parla: { namespaces: { widget: { format: 'icu', path: 'locales/{locale}/widget.json' } } },
    });
    write('locales/en/widget.json', { title: 'Widget', terms: 'Read the <link>terms</link>' });
    const built = await build({ cwd: pkg, write: 'types' });
    expect(built.config.runtime).toBe('@parlajs/react');
    expect(readFileSync(join(pkg, 'src/parla/catalog.d.ts'), 'utf8')).toContain(
      "declare module '@parlajs/react'",
    );

    write(
      'src/usage.ts',
      `import type { ReactNode } from 'react';
import { useParla } from '@parlajs/react';
import type { Parla, Translations } from '@parlajs/react';
import './parla/catalog.js';
const { t } = useParla(['widget']);
export const title: string = t.widget.title();
export const terms: ReactNode = t.widget.terms({ link: (children) => children });
// @ts-expect-error a ReactNode is not a number, so the adapter's node type reached the types
export const wrong: number = t.widget.terms({ link: (children) => children });
// @ts-expect-error only the listed namespaces are in \`t\`
t.other.title();
// @ts-expect-error the namespace is registered, so an unknown one is rejected
useParla(['widget', 'missing']);
// @ts-expect-error always a list, even for one namespace
useParla('widget');
declare const parla: Parla;
export const loaded: Translations<'widget'> = await parla.load(['widget']);
// @ts-expect-error a child demanding a namespace needs a \`t\` that loaded it
export const unloaded: Translations<'widget'> = await parla.load([]);
`,
    );
    const reactTypes = join(repo, 'packages/react/node_modules/@types/react');
    write('tsconfig.json', {
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: 'preserve',
        moduleResolution: 'bundler',
        skipLibCheck: false,
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

describe('one catalog, two node types', () => {
  const dir = join(repo, '.tmp', 'build-test-nodes');
  const write = (file: string, content: unknown): void => {
    const path = join(dir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  };

  it("types each instance's rich text as its own node: ReactNode beside string", async () => {
    rmSync(dir, { recursive: true, force: true });
    write(
      'parla.config.ts',
      configModule({
        locales: ['en'],
        markup: ['strong'],
        namespaces: { app: { format: 'icu', path: 'locales/{locale}/app.json' } },
      }),
    );
    write('locales/en/app.json', { title: 'Title', terms: 'Read the <link>terms</link>' });
    await build({ cwd: dir, write: 'types' });

    write(
      'src/usage.ts',
      `import { createElement } from 'react';
import type { ReactNode } from 'react';
import { createParla as createCore } from '@parlajs/core';
import type { Translations } from '@parlajs/core';
import { createParla as createReact } from '@parlajs/react';
import type { WrapRich } from '@parlajs/react';
import { catalog } from './parla/catalog.js';

const web = createReact({ catalog, markup: { strong: (c) => createElement('b', null, c) } });
const email = createCore({ catalog, markup: { strong: (c) => \`**\${c}**\` } });
const { app: w } = await web.load(['app']);
const { app: e } = await email.load(['app']);
export const titles: string[] = [w.title(), e.title()];
export const node: ReactNode = w.terms({ link: (c) => createElement('a', null, c) });
export const text: string = e.terms({ link: (c) => \`[\${c}]\` });
// @ts-expect-error a React instance's rich text is a ReactNode, not a string
export const notText: string = w.terms({ link: (c) => c });
// @ts-expect-error a string instance's markup callback returns a string
e.terms({ link: () => createElement('a') });
// @ts-expect-error a React \`t\` is not a string instance's
export const wrongT: Translations<'app'> = await web.load(['app']);
// @ts-expect-error a string instance's markup renderer returns a string
createCore({ catalog, markup: { strong: () => createElement('b') } });
// @ts-expect-error a React markup renderer returns a ReactNode
createReact({ catalog, markup: { strong: () => new Date() } });
// @ts-expect-error a string instance's wrapRich returns a string
createCore<string>({ catalog, markup: { strong: (c) => c }, wrapRich: (parts) => parts });
// @ts-expect-error a React wrapRich returns a ReactNode
export const wrap: WrapRich = () => new Date();
`,
    );
    const reactTypes = join(repo, 'packages/react/node_modules/@types/react');
    write('tsconfig.json', {
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: 'preserve',
        moduleResolution: 'bundler',
        skipLibCheck: false,
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
      execFileSync(tsc, ['-p', join(dir, 'tsconfig.json')], { encoding: 'utf8' }),
    ).not.toThrow();
  });
});

describe('chunks', () => {
  const dir = join(repo, '.tmp', 'build-test-chunk');

  it('build the accessor in one call, keeping a `__proto__` key as a message', async () => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'locales/en'), { recursive: true });
    writeFileSync(
      join(dir, 'parla.config.ts'),
      configModule({
        locales: ['en'],
        namespaces: { app: { format: 'icu', path: 'locales/{locale}/app.json' } },
      }),
    );
    // Past 127 keys a group is a literal plus assignments, and `__proto__` must stay a message.
    const big = Object.fromEntries(Array.from({ length: 130 }, (_, i) => [`k${i}`, `Big ${i}`]));
    writeFileSync(
      join(dir, 'locales/en/app.json'),
      `{ "__proto__": "Proto", "plain": "Plain", "nav": { "home": "Home" }, "terms": "Read the <link>terms</link>", "big": ${JSON.stringify(big).slice(0, -1)}, "__proto__": "Big proto" } }`,
    );
    await build({ cwd: dir });
    const chunk = readFileSync(join(dir, 'src/parla/messages/en/app.js'), 'utf8');
    expect(chunk).toContain('"plain": (p) => "Plain",');

    const { catalog } = (await import(pathToFileURL(join(dir, 'src/parla/catalog.js')).href)) as {
      catalog: Catalog;
    };
    const loaded = await createParla({ catalog }).load(['app']);
    const t = loaded['app'] as Record<string, unknown> & {
      plain: () => string;
      nav: { home: () => string };
      terms: (params?: object) => string;
      big: Record<string, () => string>;
    };
    expect(Object.getPrototypeOf(t)).toBe(Object.prototype);
    const proto = Object.getOwnPropertyDescriptor(t, '__proto__')?.value as
      | (() => string)
      | undefined;
    expect(proto?.()).toBe('Proto');
    expect([t.plain(), t.nav.home()]).toStrictEqual(['Plain', 'Home']);
    expect([t.big['k0']?.(), t.big['k129']?.()]).toStrictEqual(['Big 0', 'Big 129']);
    expect(Object.getPrototypeOf(t.big)).toBe(Object.prototype);
    const bigProto = Object.getOwnPropertyDescriptor(t.big, '__proto__')?.value as
      | (() => string)
      | undefined;
    expect(bigProto?.()).toBe('Big proto');
    // Markup without its callback keeps the children, as before.
    expect(t.terms()).toBe('Read the terms');
  });
});

describe('select keys', () => {
  const dir = join(repo, '.tmp', 'build-test-select');

  it('match whatever order a translation lists its variants in', async () => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'locales/en'), { recursive: true });
    mkdirSync(join(dir, 'locales/it'), { recursive: true });
    writeFileSync(
      join(dir, 'parla.config.ts'),
      configModule({
        locales: ['en', 'it'],
        namespaces: { app: { format: 'icu', path: 'locales/{locale}/app.json' } },
      }),
    );
    writeFileSync(
      join(dir, 'locales/en/app.json'),
      JSON.stringify({ reply: '{g, select, male {He} female {She} other {They}} replied' }),
    );
    writeFileSync(
      join(dir, 'locales/it/app.json'),
      JSON.stringify({ reply: '{g, select, female {Lei} male {Lui} other {Loro}} ha risposto' }),
    );
    const built = await build({ cwd: dir, write: 'types' });
    expect(built.diagnostics).toStrictEqual([]);
    expect(readFileSync(join(dir, 'src/parla/types/app.d.ts'), 'utf8')).toContain(
      'reply(params: { g: "female" | "male" | (string & {}) }): string;',
    );
  });
});

describe('interface names', () => {
  const dir = join(repo, '.tmp', 'build-test-names');

  it('are numbered when two namespaces would share one', async () => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'locales/en'), { recursive: true });
    writeFileSync(
      join(dir, 'parla.config.ts'),
      configModule({
        locales: ['en'],
        namespaces: {
          'foo-bar': { format: 'icu', path: 'locales/{locale}/foo-bar.json' },
          foo_bar: { format: 'icu', path: 'locales/{locale}/foo_bar.json' },
        },
      }),
    );
    writeFileSync(join(dir, 'locales/en/foo-bar.json'), JSON.stringify({ dash: 'Dash' }));
    writeFileSync(join(dir, 'locales/en/foo_bar.json'), JSON.stringify({ under: 'Under' }));
    await build({ cwd: dir, write: 'types' });
    const types = (ns: string): string =>
      readFileSync(join(dir, `src/parla/types/${ns}.d.ts`), 'utf8');
    expect(types('foo-bar')).toContain(
      'export interface FooBarMessages<Node> {\n  /** Dash */\n  dash(): string;',
    );
    expect(types('foo_bar')).toContain(
      'export interface FooBar2Messages<Node> {\n  /** Under */\n  under(): string;',
    );
    const dts = readFileSync(join(dir, 'src/parla/catalog.d.ts'), 'utf8');
    expect(dts).toMatch(/"foo-bar": FooBarMessages<Node>;\s+"foo_bar": FooBar2Messages<Node>;/);
  });
});

describe('custom functions and default markup', () => {
  const dir = join(repo, '.tmp', 'build-test-extensions');
  const write = (file: string, content: unknown): void => {
    const path = join(dir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  };

  it('registers them, renders them, and requires their implementations', async () => {
    rmSync(dir, { recursive: true, force: true });
    write(
      'parla.config.ts',
      configModule({
        locales: ['en'],
        functions: { capitalize: 'string' },
        markup: ['strong'],
        namespaces: { app: { format: 'icu', path: 'locales/{locale}/app.json' } },
      }),
    );
    write('locales/en/app.json', {
      by: 'By {name, capitalize}',
      bold: 'A <strong>bold</strong> move',
      link: 'Read the <link>terms</link>',
    });
    const built = await build({ cwd: dir });
    expect(built.diagnostics).toStrictEqual([]);
    write(
      'shadow/parla.config.ts',
      configModule({ locales: ['en'], functions: { number: 'string' } }),
    );
    await expect(build({ cwd: join(dir, 'shadow') })).rejects.toThrow(
      '"functions" cannot redefine the built-in :number',
    );
    const dts = readFileSync(join(dir, 'src/parla/catalog.d.ts'), 'utf8');
    expect(dts).toContain(
      '  interface FunctionRegistry {\n    "capitalize": true;\n  }\n  interface MarkupRegistry {\n    "strong": true;\n  }\n',
    );
    expect(readFileSync(join(dir, 'src/parla/types/app.d.ts'), 'utf8')).toContain(
      'bold(params?: { strong?: (children: Node) => Node }): Node;',
    );

    const { catalog } = (await import(pathToFileURL(join(dir, 'src/parla/catalog.js')).href)) as {
      catalog: Catalog;
    };
    const parla = createParla({
      catalog,
      functions: {
        capitalize: (value: unknown) =>
          String(value).charAt(0).toUpperCase() + String(value).slice(1),
      },
      markup: { strong: (children: unknown) => `**${String(children)}**` },
      // This spec's program has no generated registries, so the options are not typed here.
    } as never);
    const loaded = await parla.load(['app']);
    const t = loaded['app'] as {
      by: (p: { name: string }) => string;
      bold: (p?: { strong?: (c: unknown) => unknown }) => unknown;
    };
    expect(t.by({ name: 'ada' })).toBe('By Ada');
    expect(t.bold()).toBe('A **bold** move');
    expect(t.bold({ strong: (c) => `<${String(c)}>` })).toBe('A <bold> move');

    write(
      'src/usage.ts',
      `import { createParla } from '@parlajs/core';
import type { Namespaces } from '@parlajs/core';
import { catalog } from './parla/catalog.js';
declare const t: Namespaces['app'];
export const ok: unknown[] = [t.bold(), t.by({ name: 'ada' }), t.link({ link: (c) => c })];
// @ts-expect-error markup without a default stays required
t.link();
export const parla = createParla({
  catalog,
  functions: { capitalize: (v) => String(v) },
  markup: { strong: (c) => c },
});
// @ts-expect-error a declared function needs its implementation
createParla({ catalog, markup: { strong: (c) => c } });
// @ts-expect-error declared markup needs its renderer
createParla({ catalog, functions: { capitalize: (v) => String(v) }, markup: {} });
`,
    );
    write('tsconfig.json', {
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: 'preserve',
        moduleResolution: 'bundler',
        skipLibCheck: false,
        allowImportingTsExtensions: true,
        allowJs: false,
        types: [],
        paths: { '@parlajs/core': [join(repo, 'packages/core/src/index.ts')] },
      },
      include: ['src'],
    });
    const tsc = join(repo, 'node_modules/.bin/tsc');
    expect(() =>
      execFileSync(tsc, ['-p', join(dir, 'tsconfig.json')], { encoding: 'utf8' }),
    ).not.toThrow();
  });
});

describe("a package's types beside the app's", () => {
  const dir = join(repo, '.tmp', 'build-test-registries');
  const write = (file: string, content: unknown): void => {
    const path = join(dir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  };

  it('add up, whichever loads first and with or without skipLibCheck', async () => {
    rmSync(dir, { recursive: true, force: true });
    const ui = 'node_modules/@acme/ui';
    write(`${ui}/package.json`, {
      name: '@acme/ui',
      parla: { namespaces: { ui: { format: 'icu', path: 'locales/{locale}/ui.json' } } },
    });
    write(`${ui}/locales/en/ui.json`, { save: 'Save' });
    write(
      'parla.config.ts',
      configModule({
        locales: ['en', 'it'],
        namespaces: { app: { format: 'icu', path: 'locales/{locale}/app.json' } },
        packages: ['@acme/ui'],
      }),
    );
    write('locales/en/app.json', { hi: 'Hi' });
    write('locales/it/app.json', { hi: 'Ciao' });
    await build({ cwd: join(dir, ui), write: 'types' });
    await build({ cwd: dir });

    const usage = `import type { Locale, Namespaces } from '@parlajs/core';
declare const n: Namespaces;
export const both: string[] = [n.app.hi(), n.ui.save()];
export const it: Locale = 'it';
// @ts-expect-error not a locale of the app or the package
export const fr: Locale = 'fr';
`;
    const tsc = join(repo, 'node_modules/.bin/tsc');
    for (const packageFirst of [true, false]) {
      const imports = [`import '../${ui}/src/parla/catalog.js';`, "import './parla/catalog.js';"];
      write(
        'src/usage.ts',
        `${(packageFirst ? imports : imports.toReversed()).join('\n')}\n${usage}`,
      );
      for (const skipLibCheck of [false, true]) {
        write('tsconfig.json', {
          compilerOptions: {
            strict: true,
            noEmit: true,
            module: 'preserve',
            moduleResolution: 'bundler',
            skipLibCheck,
            allowImportingTsExtensions: true,
            types: [],
            paths: { '@parlajs/core': [join(repo, 'packages/core/src/index.ts')] },
          },
          include: ['src', `${ui}/src`],
        });
        expect(() =>
          execFileSync(tsc, ['-p', join(dir, 'tsconfig.json')], { encoding: 'utf8' }),
        ).not.toThrow();
      }
    }
  });
});

describe('builds running at once', () => {
  const dir = join(repo, '.tmp', 'build-test-parallel');

  it('write through a rename, and leave another build’s temp file alone', async () => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'locales/en'), { recursive: true });
    writeFileSync(
      join(dir, 'parla.config.ts'),
      configModule({
        locales: ['en'],
        namespaces: { app: { format: 'icu', path: 'locales/{locale}/app.json' } },
      }),
    );
    writeFileSync(join(dir, 'locales/en/app.json'), JSON.stringify({ title: 'Title' }));
    const messages = join(dir, 'src/parla/messages/en');
    mkdirSync(messages, { recursive: true });
    writeFileSync(join(messages, '.app.js.1.tmp'), 'another build, mid-write');
    writeFileSync(join(messages, 'stale.js'), 'a namespace since removed');

    await build({ cwd: dir });
    expect(readdirSync(messages).toSorted()).toStrictEqual(['.app.js.1.tmp', 'app.js']);
    expect(readdirSync(join(dir, 'src/parla')).filter((f) => f.endsWith('.tmp'))).toStrictEqual([]);
  });
});
