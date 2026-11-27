import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createParla } from '@parlajs/core';
import type { Catalog, Namespace } from '@parlajs/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { build, formatDiagnostic } from '../src/build.ts';
import type { BuildResult } from '../src/build.ts';

import { typecheck } from './typecheck.ts';

/** A `parla.config.ts` exporting `config`. */
const configModule = (config: object): string =>
  `export default ${JSON.stringify(config, null, 2)};\n`;

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const tmp = join(repo, '.tmp');

function put(dir: string, file: string, content: unknown): void {
  const path = join(dir, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

const importFrom = async <T>(file: string): Promise<T> =>
  (await import(pathToFileURL(file).href)) as T;

/** A built project's catalog and one namespace object. */
async function imported(
  dir: string,
  namespace: string,
): Promise<{ catalog: Catalog; ns: Namespace }> {
  const out = join(dir, 'src/parla');
  const { catalog } = await importFrom<{ catalog: Catalog }>(join(out, 'catalog.js'));
  const mod = await importFrom<Record<string, Namespace>>(
    join(out, 'namespaces', `${namespace}.js`),
  );
  return { catalog, ns: Object.values(mod)[0] as Namespace };
}

interface CheckoutMessages {
  title: () => string;
  cart: { items: (params: { count: number }) => string };
  terms: (params: { link: (children: string) => string }) => string;
}

interface CommonMessages {
  greeting: (params: { name: string }) => string;
}

const app = join(tmp, 'build-test', 'app');
let result: BuildResult;

async function setup(): Promise<void> {
  rmSync(join(tmp, 'build-test'), { recursive: true, force: true });
  put(
    app,
    'parla.config.ts',
    configModule({
      locales: ['en', 'it', 'de'],
      sourceLocale: 'en',
      namespaces: {
        checkout: { format: 'mf2', path: 'locales/{locale}/checkout.json' },
        common: { format: 'icu', path: 'locales/{locale}/common.json' },
      },
    }),
  );
  put(app, 'locales/en/checkout.json', {
    title: 'Checkout',
    cart: {
      items: '.input {$count :number}\n.match $count\none {{{$count} item}}\n* {{{$count} items}}',
    },
    total: 'Total {$amount :currency currency=EUR}',
    terms: 'Accept the {#link}terms{/link}',
  });
  put(app, 'locales/it/checkout.json', {
    title: 'Cassa',
    cart: {
      items:
        '.input {$count :number}\n.match $count\none {{{$count} articolo}}\n* {{{$count} articoli}}',
    },
    total: 'Totale {$amount :currency currency=EUR} per {$who}',
    extra: 'Not in the source',
  });
  put(app, 'locales/en/common.json', { greeting: 'Hello {name}!', save: 'Save' });
  put(app, 'locales/it/common.json', { greeting: 'Ciao {name}!', save: 'Salva' });
  put(app, 'locales/de/common.json', { greeting: 'Hallo {name}!', save: 'Speichern' });
  result = await build({ cwd: app });
}

describe(build, () => {
  beforeAll(setup);

  it('writes a catalog, one object per namespace and one chunk per locale and namespace', () => {
    const out = join(app, 'src/parla');
    const missing = [
      'catalog.js',
      'catalog.d.ts',
      'namespaces/checkout.js',
      'namespaces/checkout.d.ts',
      'messages/en/checkout.js',
      'messages/it/common.js',
      'messages/de/checkout.js',
    ].filter((f) => !existsSync(join(out, f)));
    expect(missing).toStrictEqual([]);
    const chunk = readFileSync(join(out, 'messages/it/checkout.js'), 'utf8');
    expect(chunk).not.toContain('"extra"');
    expect(chunk).toContain('articoli');
    expect(chunk).not.toContain('Checkout');
    expect(readFileSync(join(out, 'namespaces/checkout.js'), 'utf8')).toContain(
      'export const checkout = {\n  name: "checkout",\n  load: {\n    "en": () => import("../messages/en/checkout.js"),',
    );
    // The catalog is the locales only: an app loads what it imports.
    expect(readFileSync(join(out, 'catalog.js'), 'utf8')).not.toContain('checkout');
    expect(readFileSync(join(out, 'catalog.d.ts'), 'utf8')).not.toContain('Checkout');
  });

  it('removes the objects of a namespace since removed', async () => {
    const out = join(app, 'src/parla/namespaces');
    writeFileSync(join(out, 'removed.js'), 'a namespace since removed');
    writeFileSync(join(out, 'removed.d.ts'), 'a namespace since removed');
    await build({ cwd: app });
    expect(readdirSync(out).toSorted()).toStrictEqual([
      'checkout.d.ts',
      'checkout.js',
      'common.d.ts',
      'common.js',
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
    const { catalog, ns: checkout } = await imported(app, 'checkout');
    const { ns: common } = await imported(app, 'common');
    const parla = createParla({ catalog, locale: 'it' });
    const italian = await parla.load([checkout]);
    const t = italian['checkout'] as CheckoutMessages;
    expect(t.title()).toBe('Cassa');
    expect(t.cart.items({ count: 1 })).toBe('1 articolo');
    expect(t.cart.items({ count: 4 })).toBe('4 articoli');
    expect(t.terms({ link: (c: string) => `[${c}]` })).toBe('Accept the [terms]');
    await parla.setLocale('de');
    const de = await parla.load([common]);
    expect((de['common'] as CommonMessages).greeting({ name: 'Ada' })).toBe('Hallo Ada!');
    const back = await parla.load([checkout]);
    expect(back['checkout']).toHaveProperty('title');
  });

  it('generates types that catch wrong calls, strings and namespaces built for other locales', async () => {
    const dts = readFileSync(join(app, 'src/parla/namespaces/checkout.d.ts'), 'utf8');
    expect(dts).toContain("import type { Namespace, NamespaceKind, Text } from '@parlajs/core';");
    expect(dts).toContain('  /** Checkout */\n  title: Text;');
    expect(dts).toContain('items(params: { count: number }): string;');
    expect(dts).toContain('terms(params: { link: (children: Node) => Node }): Node;');
    expect(dts).toContain(
      "export interface CheckoutKind extends NamespaceKind {\n  readonly messages: CheckoutMessages<this['node']>;\n}",
    );
    expect(dts).toContain(
      'export declare const checkout: Namespace<"checkout", CheckoutKind, "en" | "it" | "de">;',
    );
    expect(readFileSync(join(app, 'src/parla/namespaces/common.d.ts'), 'utf8')).toContain(
      'greeting(params: { name: string | number }): string;',
    );

    const other = join(tmp, 'build-test', 'other');
    put(
      other,
      'parla.config.ts',
      configModule({
        locales: ['en', 'it'],
        namespaces: { german: { format: 'icu', path: 'locales/{locale}.json' } },
      }),
    );
    put(other, 'locales/en.json', { hi: 'Hi' });
    await build({ cwd: other });

    put(
      app,
      'src/usage.ts',
      `import type { Parla, Text, Translations } from '@parlajs/core';
import './parla/catalog.js';
import { checkout } from './parla/namespaces/checkout.js';
import { common } from './parla/namespaces/common.js';
import { german } from '../../other/src/parla/namespaces/german.js';
declare const parla: Parla;
const t = await parla.load([checkout, common]);
export const title: Text = t.checkout.title;
export const ok: string[] = [t.checkout.title(), t.checkout.cart.items({ count: 2 }), t.checkout.total({ amount: 3 }), t.common.greeting({ name: 'Ada' })];
// @ts-expect-error a plain message takes no params
t.checkout.title({});
// @ts-expect-error count must be a number
t.checkout.cart.items({ count: 'two' });
// @ts-expect-error count is required
t.checkout.cart.items();
// @ts-expect-error no such message
t.checkout.nope();
// A child demanding one namespace takes a \`t\` that loaded more.
export const child: Translations<typeof common> = t;
const one = await parla.load([checkout]);
// @ts-expect-error only the loaded namespaces are in \`t\`
export const unloaded: Translations<typeof common> = one;
// @ts-expect-error a name is not a namespace
await parla.load(['checkout']);
// @ts-expect-error always a list, even of one
await parla.load(checkout);
// @ts-expect-error built for en and it, not de
await parla.load([german]);
`,
    );
    expect(typecheck(join(tmp, 'build-test'), { include: ['app/src'] })).toBe('');
  });
});

describe('types for a package that depends on an adapter only', () => {
  const pkg = join(tmp, 'build-test-react');

  it('use the adapter, so rich text is a ReactNode', async () => {
    rmSync(pkg, { recursive: true, force: true });
    put(pkg, 'package.json', { name: '@acme/widget', peerDependencies: { '@parlajs/react': '*' } });
    put(
      pkg,
      'parla.config.ts',
      configModule({
        namespaces: { widget: { format: 'icu', path: 'locales/{locale}/widget.json' } },
      }),
    );
    put(pkg, 'locales/en/widget.json', { title: 'Widget', terms: 'Read the <link>terms</link>' });
    const built = await build({ cwd: pkg });
    expect(built.config.runtime).toBe('@parlajs/react');
    expect(readFileSync(join(pkg, 'src/parla/catalog.d.ts'), 'utf8')).toContain(
      "declare module '@parlajs/react'",
    );
    expect(readFileSync(join(pkg, 'src/parla/namespaces/widget.d.ts'), 'utf8')).toContain(
      "from '@parlajs/react';",
    );

    put(
      pkg,
      'src/usage.ts',
      `import type { ReactNode } from 'react';
import { useParla } from '@parlajs/react';
import type { Parla, Translations } from '@parlajs/react';
import './parla/catalog.js';
import { widget } from './parla/namespaces/widget.js';
const { t } = useParla([widget]);
export const title: string = t.widget.title();
export const terms: ReactNode = t.widget.terms({ link: (children) => children });
// @ts-expect-error a ReactNode is not a number, so the adapter's node type reached the types
export const wrong: number = t.widget.terms({ link: (children) => children });
// @ts-expect-error only the listed namespaces are in \`t\`
t.other.title();
// @ts-expect-error a name is not a namespace
useParla(['widget']);
// @ts-expect-error always a list, even for one namespace
useParla(widget);
declare const parla: Parla;
export const loaded: Translations<typeof widget> = await parla.load([widget]);
// @ts-expect-error a child demanding a namespace needs a \`t\` that loaded it
export const unloaded: Translations<typeof widget> = await parla.load([]);
`,
    );
    expect(typecheck(pkg)).toBe('');
  });
});

describe('one namespace, two node types', () => {
  const dir = join(tmp, 'build-test-nodes');

  it("types each instance's rich text as its own node: ReactNode beside string", async () => {
    rmSync(dir, { recursive: true, force: true });
    put(
      dir,
      'parla.config.ts',
      configModule({
        locales: ['en'],
        markup: ['strong'],
        namespaces: {
          app: { format: 'icu', path: 'locales/{locale}/app.json' },
          plain: { format: 'icu', path: 'locales/{locale}/plain.json' },
        },
      }),
    );
    put(dir, 'locales/en/app.json', {
      title: 'Title',
      nav: { home: 'Home', help: 'Read the <link>help</link>' },
      terms: 'Read the <link>terms</link>',
    });
    put(dir, 'locales/en/plain.json', { save: 'Save' });
    await build({ cwd: dir });
    const appTypes = readFileSync(join(dir, 'src/parla/namespaces/app.d.ts'), 'utf8');
    expect(appTypes).toContain('export interface AppText {\n  /** Title */\n  title: Text;\n}');
    expect(appTypes).toMatch(/export interface AppMessages<Node> extends AppText \{\n\s+nav: \{/);
    // Without markup the kind ignores the node type, so React and string instances share it.
    expect(readFileSync(join(dir, 'src/parla/namespaces/plain.d.ts'), 'utf8')).toContain(
      'export interface PlainKind extends NamespaceKind {\n  readonly messages: PlainMessages;\n}',
    );

    put(
      dir,
      'src/usage.ts',
      `import { createElement } from 'react';
import type { ReactNode } from 'react';
import { createParla as createCore } from '@parlajs/core';
import type { Translations } from '@parlajs/core';
import { createParla as createReact } from '@parlajs/react';
import type { Translations as ReactTranslations, WrapRich } from '@parlajs/react';
import { catalog } from './parla/catalog.js';
import { app } from './parla/namespaces/app.js';
import type { AppMessages, AppText } from './parla/namespaces/app.js';
import { plain } from './parla/namespaces/plain.js';
import type { PlainMessages } from './parla/namespaces/plain.js';

const web = createReact({ catalog, markup: { strong: (c) => createElement('b', null, c) } });
const email = createCore({ catalog, markup: { strong: (c) => \`**\${c}**\` } });
const { app: w } = await web.load([app]);
const { app: e } = await email.load([app]);
// @ts-expect-error a namespace without markup takes no node type
export type PlainOfString = PlainMessages<string>;
// @ts-expect-error the plain part of a namespace with markup takes no node type
export type TextOfString = AppText<string>;
export const plainPart: AppText = {} as AppMessages<ReactNode>;
const { plain: wp } = await web.load([plain]);
const { plain: ep } = await email.load([plain]);
export const saves: string[] = [wp.save(), ep.save()];
export const help: ReactNode = w.nav.help({ link: (c) => c });
// @ts-expect-error a group with markup follows the instance's node type
export const helpText: string = w.nav.help({ link: (c) => c });
export const titles: string[] = [w.title(), e.title()];
export const node: ReactNode = w.terms({ link: (c) => createElement('a', null, c) });
export const text: string = e.terms({ link: (c) => \`[\${c}]\` });
// @ts-expect-error a React instance's rich text is a ReactNode, not a string
export const notText: string = w.terms({ link: (c) => c });
// @ts-expect-error a string instance's markup callback returns a string
e.terms({ link: () => createElement('a') });
// @ts-expect-error a React \`t\` is not a string instance's
export const wrongT: Translations<typeof app> = await web.load([app]);
// @ts-expect-error a string \`t\` is not a React instance's
export const wrongReactT: ReactTranslations<typeof app> = await email.load([app]);
// Without markup, either instance's \`t\` will do, also inside a wider one.
export const plainT: Translations<typeof plain> = await web.load([plain]);
export const plainReactT: ReactTranslations<typeof plain> = await email.load([app, plain]);
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
    expect(typecheck(dir)).toBe('');
  });
});

describe('chunks', () => {
  const dir = join(tmp, 'build-test-chunk');

  it('build the accessor in one call, keeping a `__proto__` key as a message', async () => {
    rmSync(dir, { recursive: true, force: true });
    put(
      dir,
      'parla.config.ts',
      configModule({
        locales: ['en'],
        namespaces: { app: { format: 'icu', path: 'locales/{locale}/app.json' } },
      }),
    );
    // Past 127 keys a group is a literal plus assignments, and `__proto__` must stay a message.
    const big = Object.fromEntries(Array.from({ length: 130 }, (_, i) => [`k${i}`, `Big ${i}`]));
    put(
      dir,
      'locales/en/app.json',
      `{ "__proto__": "Proto", "plain": "Plain", "nav": { "home": "Home" }, "terms": "Read the <link>terms</link>", "big": ${JSON.stringify(big).slice(0, -1)}, "__proto__": "Big proto" } }`,
    );
    await build({ cwd: dir });
    const chunk = readFileSync(join(dir, 'src/parla/messages/en/app.js'), 'utf8');
    expect(chunk).toContain('"plain": (p) => "Plain",');

    const { catalog, ns } = await imported(dir, 'app');
    const loaded = await createParla({ catalog }).load([ns]);
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
  const dir = join(tmp, 'build-test-select');

  it('match whatever order a translation lists its variants in', async () => {
    rmSync(dir, { recursive: true, force: true });
    put(
      dir,
      'parla.config.ts',
      configModule({
        locales: ['en', 'it'],
        namespaces: { app: { format: 'icu', path: 'locales/{locale}/app.json' } },
      }),
    );
    put(dir, 'locales/en/app.json', {
      reply: '{g, select, male {He} female {She} other {They}} replied',
    });
    put(dir, 'locales/it/app.json', {
      reply: '{g, select, female {Lei} male {Lui} other {Loro}} ha risposto',
    });
    const built = await build({ cwd: dir });
    expect(built.diagnostics).toStrictEqual([]);
    expect(readFileSync(join(dir, 'src/parla/namespaces/app.d.ts'), 'utf8')).toContain(
      'reply(params: { g: "female" | "male" | (string & {}) }): string;',
    );
  });
});

describe('select params', () => {
  const dir = join(tmp, 'build-test-branches');

  it("are required only in their branch, and a translation's branch needs no more", async () => {
    rmSync(dir, { recursive: true, force: true });
    put(
      dir,
      'parla.config.ts',
      configModule({
        locales: ['en', 'it'],
        namespaces: { app: { format: 'icu', path: 'locales/{locale}/app.json' } },
      }),
    );
    const ref = '{kind, select, part {Part {part}} chapter {Chapter {chapter}} other {{title}}}';
    put(dir, 'locales/en/app.json', {
      ref,
      heading: '{context, select, part_one {Part one} other {Part {part} / {title}}}',
    });
    put(dir, 'locales/it/app.json', {
      ref: '{kind, select, part {Parte {part}} chapter {Capitolo {chapter}} other {{title}}}',
      heading: '{context, select, part_one {Parte {part}} other {Parte {part} / {title}}}',
    });
    const built = await build({ cwd: dir });
    expect(
      built.diagnostics.map((d) => `${d.code}:${d.locale}:${d.key}:${d.message}`),
    ).toStrictEqual([
      'param-mismatch:it:heading:needs $part when $context is "part_one", but the source does not',
    ]);
    put(
      dir,
      'src/usage.ts',
      `import type { AppMessages } from './parla/namespaces/app.js';
declare const t: AppMessages;
declare const kind: string;
export const ok: string[] = [
  t.ref({ kind: 'part', part: 1 }),
  t.ref({ kind: 'chapter', chapter: 2 }),
  t.ref({ kind, part: 1, chapter: 2, title: 'Dune' }),
  t.heading({ context: 'part_one' }),
  t.heading({ context: 'part_two', part: 2, title: 'Dune' }),
];
// @ts-expect-error \`part\` is needed when kind is "part"
t.ref({ kind: 'part', chapter: 2 });
// @ts-expect-error \`chapter\` is needed when kind is "chapter"
t.ref({ kind: 'chapter' });
// @ts-expect-error a plain string may be any kind, so it needs every branch's params
t.ref({ kind, title: 'Dune' });
// @ts-expect-error any other context needs \`part\` and \`title\`
t.heading({ context: 'part_two' });
`,
    );
    expect(typecheck(dir)).toBe('');
  });
});

describe('names', () => {
  const dir = join(tmp, 'build-test-names');

  it('are numbered when two namespaces would share one, and never shadow an import or a keyword', async () => {
    rmSync(dir, { recursive: true, force: true });
    const files = {
      'foo-bar': {},
      foo_bar: {},
      '-': {},
      namespace: {},
      default: {},
      undefined: {},
      scope_audit: {},
      nav: {},
    };
    put(
      dir,
      'parla.config.ts',
      configModule({
        locales: ['en'],
        namespaces: Object.fromEntries(
          Object.keys(files).map((ns) => [
            ns,
            { format: 'icu', path: `locales/{locale}/${ns}.json` },
          ]),
        ),
      }),
    );
    put(dir, 'locales/en/-.json', { go: 'Go', b: '<b>B</b>' });
    put(dir, 'locales/en/foo-bar.json', { dash: 'Dash' });
    put(dir, 'locales/en/foo_bar.json', { under: 'Under' });
    put(dir, 'locales/en/namespace.json', { ns: 'Namespace' });
    put(dir, 'locales/en/default.json', { def: 'Default' });
    put(dir, 'locales/en/undefined.json', { undef: 'Undefined' });
    put(dir, 'locales/en/scope_audit.json', { scope: 'Scope' });
    // `Text` only inside a group with markup still needs its import.
    put(dir, 'locales/en/nav.json', { nav: { home: 'Home', help: '<b>Help</b>' } });
    await build({ cwd: dir });
    const types = (ns: string): string =>
      readFileSync(join(dir, `src/parla/namespaces/${ns}.d.ts`), 'utf8');
    expect(types('foo-bar')).toContain(
      'export interface FooBarMessages {\n  /** Dash */\n  dash: Text;',
    );
    expect(types('foo-bar')).toContain('export declare const fooBar: Namespace<"foo-bar"');
    expect(types('foo_bar')).toContain(
      'export interface FooBar2Messages {\n  /** Under */\n  under: Text;',
    );
    // the name itself where it is an identifier, matching `t.foo_bar`
    expect(types('foo_bar')).toContain('export declare const foo_bar: Namespace<"foo_bar"');
    expect(types('scope_audit')).toContain(
      'export declare const scope_audit: Namespace<"scope_audit"',
    );
    // not `Text`, which would shadow the imported one
    expect(types('-')).toContain('export interface _Messages<Node> extends _Text {');
    // not `NamespaceKind`, which would shadow the imported one
    expect(types('namespace')).toContain('export interface Namespace2Kind extends NamespaceKind');
    expect(types('default')).toContain('export declare const _default: Namespace<"default"');
    expect(types('undefined')).toContain('export declare const _undefined: Namespace<"undefined"');
    // without it, `Text` would be the DOM's text node
    expect(types('nav')).toContain(
      "import type { Namespace, NamespaceKind, Text } from '@parlajs/core';",
    );

    const modules = await Promise.all(
      Object.keys(files).map(async (ns) =>
        importFrom<Record<string, Namespace>>(join(dir, `src/parla/namespaces/${ns}.js`)),
      ),
    );
    expect(modules.map((mod) => Object.values(mod).map((object) => object.name))).toStrictEqual(
      Object.keys(files).map((ns) => [ns]),
    );
    put(
      dir,
      'src/usage.ts',
      Object.keys(files)
        .map((ns) => `export * from './parla/namespaces/${ns}.js';\n`)
        .join(''),
    );
    expect(typecheck(dir)).toBe('');
  });
});

describe('custom functions and default markup', () => {
  const dir = join(tmp, 'build-test-extensions');

  it('registers them, renders them, and requires their implementations', async () => {
    rmSync(dir, { recursive: true, force: true });
    put(
      dir,
      'parla.config.ts',
      configModule({
        locales: ['en'],
        functions: { capitalize: 'string' },
        markup: ['strong'],
        namespaces: { app: { format: 'icu', path: 'locales/{locale}/app.json' } },
      }),
    );
    put(dir, 'locales/en/app.json', {
      by: 'By {name, capitalize}',
      bold: 'A <strong>bold</strong> move',
      link: 'Read the <link>terms</link>',
    });
    const built = await build({ cwd: dir });
    expect(built.diagnostics).toStrictEqual([]);
    put(
      dir,
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
    expect(readFileSync(join(dir, 'src/parla/namespaces/app.d.ts'), 'utf8')).toContain(
      'bold(params?: { strong?: (children: Node) => Node }): Node;',
    );

    const { catalog, ns } = await imported(dir, 'app');
    const parla = createParla({
      catalog,
      functions: {
        capitalize: (value: unknown) =>
          String(value).charAt(0).toUpperCase() + String(value).slice(1),
      },
      markup: { strong: (children: unknown) => `**${String(children)}**` },
      // This spec's program has no generated registries, so the options are not typed here.
    } as never);
    const loaded = await parla.load([ns]);
    const t = loaded['app'] as {
      by: (p: { name: string }) => string;
      bold: (p?: { strong?: (c: unknown) => unknown }) => unknown;
    };
    expect(t.by({ name: 'ada' })).toBe('By Ada');
    expect(t.bold()).toBe('A **bold** move');
    expect(t.bold({ strong: (c) => `<${String(c)}>` })).toBe('A <bold> move');

    put(
      dir,
      'src/usage.ts',
      `import { createParla } from '@parlajs/core';
import { catalog } from './parla/catalog.js';
import { app } from './parla/namespaces/app.js';
export const parla = createParla({
  catalog,
  functions: { capitalize: (v) => String(v) },
  markup: { strong: (c) => c },
});
const { app: t } = await parla.load([app]);
export const ok: unknown[] = [t.bold(), t.by({ name: 'ada' }), t.link({ link: (c) => c })];
// @ts-expect-error markup without a default stays required
t.link();
// @ts-expect-error a declared function needs its implementation
createParla({ catalog, markup: { strong: (c) => c } });
// @ts-expect-error declared markup needs its renderer
createParla({ catalog, functions: { capitalize: (v) => String(v) }, markup: {} });
`,
    );
    expect(typecheck(dir)).toBe('');
  });
});

describe("a package's registries beside the app's", () => {
  const dir = join(tmp, 'build-test-registries');

  it('add up, whichever loads first and with or without skipLibCheck', async () => {
    rmSync(dir, { recursive: true, force: true });
    const ui = 'node_modules/@acme/ui';
    put(
      dir,
      `${ui}/parla.config.ts`,
      configModule({
        locales: ['en', 'it', 'de'],
        markup: ['em'],
        namespaces: { ui: { format: 'icu', path: 'locales/{locale}/ui.json' } },
      }),
    );
    put(dir, `${ui}/locales/en/ui.json`, { save: 'Save' });
    put(
      dir,
      'parla.config.ts',
      configModule({
        locales: ['en', 'it'],
        markup: ['strong'],
        namespaces: { app: { format: 'icu', path: 'locales/{locale}/app.json' } },
      }),
    );
    put(dir, 'locales/en/app.json', { hi: 'Hi' });
    put(dir, 'locales/it/app.json', { hi: 'Ciao' });
    await build({ cwd: join(dir, ui) });
    await build({ cwd: dir });

    const usage = `import type { Locale, MarkupName } from '@parlajs/core';
export const it: Locale = 'it';
export const tags: MarkupName[] = ['em', 'strong'];
// @ts-expect-error not a locale of the app or the package
export const fr: Locale = 'fr';
`;
    for (const packageFirst of [true, false]) {
      const imports = [`import '../${ui}/src/parla/catalog.js';`, "import './parla/catalog.js';"];
      put(
        dir,
        'src/usage.ts',
        `${(packageFirst ? imports : imports.toReversed()).join('\n')}\n${usage}`,
      );
      for (const skipLibCheck of [false, true]) {
        expect(typecheck(dir, { include: ['src', `${ui}/src`], skipLibCheck })).toBe('');
      }
    }
  });
});

describe('diagnostics', () => {
  const dir = join(tmp, 'build-test-diagnostics');

  it('report broken catalogs, and a check writes nothing', async () => {
    rmSync(dir, { recursive: true, force: true });
    put(
      dir,
      'parla.config.ts',
      configModule({
        locales: ['en'],
        namespaces: {
          json: { format: 'icu', path: 'locales/{locale}/json.json' },
          shape: { format: 'icu', path: 'locales/{locale}/shape.json' },
          weird: { format: 'yaml', path: 'locales/{locale}/weird.json' },
        },
      }),
    );
    put(dir, 'locales/en/json.json', '{ not json');
    put(dir, 'locales/en/shape.json', { list: ['a'], a: 'A', 'a.b': 'B', bad: '{oops' });
    const { diagnostics, config, written } = await build({ cwd: dir, write: false });
    expect(written).toStrictEqual([]);
    expect(existsSync(join(dir, 'src'))).toBe(false);
    expect(diagnostics.map((d) => `${d.code}:${d.namespace}:${d.key ?? ''}`)).toStrictEqual([
      'invalid-resource:json:',
      'invalid-resource:shape:list',
      'key-conflict:shape:a',
      'invalid-syntax:shape:bad',
      'unknown-format:weird:',
    ]);
    expect(diagnostics.map((d) => formatDiagnostic(d, config.root))).toContainEqual(
      'error   [invalid-resource] shape › en › list: expected a string or an object, got array (locales/en/shape.json)',
    );
    expect(formatDiagnostic({ level: 'warning', code: 'unknown-key', message: 'm' })).toBe(
      'warning [unknown-key] : m',
    );
  });
});

describe('builds running at once', () => {
  const dir = join(tmp, 'build-test-parallel');

  it('write through a rename, and leave another build’s temp file alone', async () => {
    rmSync(dir, { recursive: true, force: true });
    put(
      dir,
      'parla.config.ts',
      configModule({
        locales: ['en'],
        namespaces: { app: { format: 'icu', path: 'locales/{locale}/app.json' } },
      }),
    );
    put(dir, 'locales/en/app.json', { title: 'Title' });
    const messages = join(dir, 'src/parla/messages/en');
    put(messages, '.app.js.1.tmp', 'another build, mid-write');
    put(messages, 'stale.js', 'a namespace since removed');

    await build({ cwd: dir });
    expect(readdirSync(messages).toSorted()).toStrictEqual(['.app.js.1.tmp', 'app.js']);
    expect(readdirSync(join(dir, 'src/parla')).filter((f) => f.endsWith('.tmp'))).toStrictEqual([]);
  });
});
