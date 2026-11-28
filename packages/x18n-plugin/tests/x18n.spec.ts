import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  FinderContext,
  LocaleFinder,
  PlaceholderSyntax,
  ScanContext,
  Scanner,
} from '@x18n/core';
import { beforeAll, describe, expect, it } from 'vitest';

import parla from '../src/index.ts';
import type { ParlaOptions } from '../src/index.ts';

const root = fileURLToPath(new URL('../../../.tmp/x18n-test', import.meta.url));

function only<T>(items: ReadonlyArray<T> | undefined): T {
  const [item] = items ?? [];
  if (item === undefined || items?.length !== 1) {
    throw new Error('expected exactly one');
  }
  return item;
}

const scanner = (options?: ParlaOptions): Scanner => only(parla(options).scanners);
const { find: placeholders, validate }: PlaceholderSyntax = only(parla().placeholders);
const names = (value: string): Array<string> =>
  placeholders(value)
    .map((placeholder) => placeholder.name)
    .toSorted();

const finder = (options?: ParlaOptions): LocaleFinder => only(parla(options).localeFinders);
// Every source catalog exists, so a read never fails.
const read = async (path: string): Promise<string> => readFile(join(root, path), 'utf8');
const finderContext = (globbed: Array<string>): FinderContext =>
  ({
    host: { root, glob: async () => Promise.resolve(globbed), readFile: read },
  }) as unknown as FinderContext;

// The scanner reads only the file; x18n's context carries config it does not need.
const context = {} as ScanContext;

interface Found {
  readonly raw: string;
  readonly namespace: string | undefined;
  readonly params: ReadonlyArray<string> | undefined;
}

async function usages(text: string, options?: ParlaOptions | Scanner): Promise<Array<Found>> {
  const scan = options && 'scan' in options ? options : scanner(options);
  const result = await scan.scan({ path: 'app.tsx', text } as never, context);
  return result.usages.map(({ raw, namespace, params }) => ({ raw, namespace, params }));
}

const header = `import { checkout } from './parla/namespaces/checkout.js';
import { common as shared } from '@acme/ui/namespaces/common.js';
`;

describe('scanner', () => {
  it('reads t.ns.key() calls on a t from useParla, keyed by namespace', async () => {
    await expect(
      usages(`${header}
function Cart() {
  const { t } = useParla([checkout, shared]);
  t.checkout.cart.items({ count: 3, ...rest });
  t.common.title();
  t.checkout.total({ amount });
}`),
    ).resolves.toStrictEqual([
      { raw: 'cart.items', namespace: 'checkout', params: undefined },
      { raw: 'title', namespace: 'common', params: [] },
      { raw: 'total', namespace: 'checkout', params: ['amount'] },
    ]);
  });

  it('skips calls outside the hook, on namespaces it did not load, or on another t', async () => {
    await expect(
      usages(`${header}
t.checkout.title();
function A() {
  const { t } = useParla([checkout]);
  t.common.title();
  t.checkout[key]();
  other.checkout.title();
}
function B() {
  t.checkout.title();
  const { t: alias } = useLoader([checkout]);
  alias.checkout.title();
}`),
    ).resolves.toStrictEqual([]);
  });

  it('follows an alias and a custom hook, and the innermost binding', async () => {
    await expect(
      usages(
        `${header}
function A() {
  const { t: tr } = useLoader([checkout]);
  function B() {
    const { t: tr } = useLoader([shared]);
    tr.common.title();
    tr.checkout.title();
  }
  tr.checkout.title();
}`,
        { callees: ['useLoader'] },
      ),
    ).resolves.toStrictEqual([
      { raw: 'title', namespace: 'common', params: [] },
      { raw: 'title', namespace: 'checkout', params: [] },
    ]);
  });

  it('follows a t typed Translations<typeof ns> in a function parameter', async () => {
    await expect(
      usages(`${header}
function Row({ t }: { t: Translations<typeof checkout | typeof shared> }) {
  t.checkout.title();
  t.common.total({ amount });
}
const Cell = ({ u, t: tr }: { u: string; t: Translations<typeof checkout> }) => tr.checkout.cell();
function Skipped(props: Props, { t }: { t: string }, { u }: { u: Translations<typeof checkout> }) {
  t.checkout.title();
}
function Unknown({ t }: { t: Translations<typeof other> }, { t: a }: { t: Props<typeof checkout> }) {
  t.checkout.title();
  a.checkout.title();
}
function Elsewhere({ t }: Props) {
  t.checkout.title();
}`),
    ).resolves.toStrictEqual([
      { raw: 'title', namespace: 'checkout', params: [] },
      { raw: 'total', namespace: 'common', params: ['amount'] },
      { raw: 'cell', namespace: 'checkout', params: [] },
    ]);
  });

  it('needs every listed namespace to be an imported namespace object', async () => {
    await expect(
      usages(`${header}
function A() {
  const { t } = useParla([checkout, 'common']);
  t.checkout.title();
}`),
    ).resolves.toStrictEqual([]);
  });
});

/** Each usage's key, and the file's text at its range, which must be the key itself. */
async function inFile(path: string, text: string): Promise<Array<[string, string]>> {
  const result = await scanner().scan({ path, text } as never, context);
  return result.usages.map(({ raw, range }) => [raw, text.slice(range.start, range.end)]);
}

const keys = (...raw: Array<string>): Array<[string, string]> => raw.map((key) => [key, key]);

describe('templates', () => {
  it('reads a Vue file: its scripts, mustaches and directives', async () => {
    await expect(
      inFile(
        'Cart.vue',
        `<script setup lang="ts">
import { checkout } from './parla/namespaces/checkout.js';
const { t } = useParla([checkout]);
const total = t.checkout.total({ amount: 1 });
</script>

<template>
  <!-- {{ t.checkout.commented() }} -->
  <h1 :title="t.checkout.title()">{{ t.checkout.heading() }}</h1>
  <p v-if="t.checkout.shown()">🛒 {{ t.checkout.cart.items({ count }) }}</p>
  <li v-for="item in items">{{ item }}</li>
  <button @click="go(t.checkout.go())">x</button>
</template>

<style>
.title { color: red; }
</style>
`,
      ),
    ).resolves.toStrictEqual(keys('total', 'title', 'heading', 'shown', 'cart.items', 'go'));
  });

  it('reads a Svelte file: its script, markup and block expressions', async () => {
    await expect(
      inFile(
        'Cart.svelte',
        `<script lang="ts">
  import { checkout } from './parla/namespaces/checkout.js';
  const { t } = useParla([checkout]);
</script>

<h1 title={t.checkout.title()}>{t.checkout.heading()}</h1>
{#if t.checkout.shown()}
  <p>{@html t.checkout.terms({ link })}</p>
{:else}
  <p>{t.checkout.empty()}</p>
{/if}
<p>{t.checkout.quoted({ text: 'a } \\' b' })}</p>
{#each items as item}{item}{/each}
{#await load() then value}{value}{/await}

<style>
  h1 { color: red; }
</style>
`,
      ),
    ).resolves.toStrictEqual(keys('title', 'heading', 'shown', 'terms', 'empty', 'quoted'));
  });

  it('reads an Astro file: its frontmatter and JSX markup', async () => {
    await expect(
      inFile(
        'Cart.astro',
        `---
import { checkout } from './parla/namespaces/checkout.js';
const { t } = useParla([checkout]);
---
<h1 title={t.checkout.title()}>{t.checkout.heading()}</h1>
<ul>{items.map((item) => <li>{t.checkout.item({ item })}</li>)}</ul>
`,
      ),
    ).resolves.toStrictEqual(keys('title', 'heading', 'item'));
  });
});

describe('placeholders', () => {
  it('names the params and tags of ICU and MF2 messages', () => {
    expect(names('{name} has {count, plural, one {# item} other {# items}}')).toStrictEqual([
      'count',
      'name',
    ]);
    expect(names('Accept the <link>terms</link>')).toStrictEqual(['link']);
    expect(names('Hello {$name}, see {#link}terms{/link}')).toStrictEqual(['link', 'name']);
    expect(names('{broken')).toStrictEqual([]);
  });

  it('reports invalid syntax, and accepts what either format parses', () => {
    expect(validate?.('{name}')).toStrictEqual([]);
    expect(validate?.('.input {$n :number}\n.match $n\n* {{n}}')).toStrictEqual([]);
    expect(validate?.('{$name')).toHaveLength(1);
  });
});

describe('catalogs', () => {
  beforeAll(() => {
    rmSync(root, { recursive: true, force: true });
    const config = {
      locales: ['en', 'it'],
      functions: { relative: 'number' },
      markup: ['code'],
      namespaces: {
        common: { format: 'icu', path: 'locales/{locale}/common.json' },
        scopeAudit: { format: 'mf2', path: 'locales/{locale}/scope_audit.json' },
      },
    };
    const file = join(root, 'app/parla.config.ts');
    mkdirSync(join(root, 'app/locales/en'), { recursive: true });
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `export default ${JSON.stringify(config)};\n`);
    const ref = '{kind, select, part {Part {part}} other {{title}}}';
    writeFileSync(
      join(root, 'app/locales/en/common.json'),
      JSON.stringify({ order: { ref }, plain: '{name}', broken: '{name' }),
    );
    writeFileSync(join(root, 'app/locales/en/scope_audit.json'), '{ not json');
    for (const [locale, hi] of [
      ['en', 'Hi %name%'],
      ['it', 'Ciao %nome%'],
    ] as const) {
      mkdirSync(join(root, `pct/locales/${locale}`), { recursive: true });
      writeFileSync(join(root, `pct/locales/${locale}/pct.properties`), `hi = ${hi}\n`);
    }
  });

  it('names each catalog file by the namespace its config gives it', async () => {
    const { find } = finder();
    const found = await find(finderContext(['app/parla.config.ts']));
    expect(found.map((c) => `${c.locale} ${c.namespace} ${c.path}`).toSorted()).toStrictEqual([
      'en common app/locales/en/common.json',
      'en scopeAudit app/locales/en/scope_audit.json',
      'it common app/locales/it/common.json',
      'it scopeAudit app/locales/it/scope_audit.json',
    ]);
  });

  it('reads the configs it is given instead of globbing, and places a new catalog', async () => {
    const { find, resolveNew } = finder({ configs: ['app/parla.config.ts'] });
    const host = finderContext([]);
    await expect(find(host)).resolves.toHaveLength(4);
    const place = (locale: string, namespace: string): string | undefined =>
      resolveNew?.({ locale, namespace, model: undefined }, host);
    expect(place('it', 'scopeAudit')).toBe('app/locales/it/scope_audit.json');
    expect(place('de', 'common')).toBeUndefined();
    expect(place('en', 'nope')).toBeUndefined();
  });

  it('takes functions, markup and branchy selects from the configs', async () => {
    const plugin = parla({ configs: ['app/parla.config.ts'] });
    const syntax = only(plugin.placeholders);
    expect(syntax.validate?.('{$when :relative}')).toHaveLength(1);
    await only(plugin.localeFinders).find(finderContext([]));
    expect(syntax.implicit).toStrictEqual(['code']);
    expect(syntax.validate?.('{$when :relative}')).toStrictEqual([]);
    await expect(
      usages(
        `import { common } from './parla/namespaces/common.js';
function A() {
  const { t } = useParla([common]);
  t.common.order.ref({ kind: 'part', part: 1 });
  t.common.plain({ name });
}`,
        only(plugin.scanners),
      ),
    ).resolves.toStrictEqual([
      { raw: 'order.ref', namespace: 'common', params: undefined },
      { raw: 'plain', namespace: 'common', params: ['name'] },
    ]);
  });

  it("reads and parses the catalogs of a config's own format with it", async () => {
    // `%name%` is a param; ICU reads the same text as plain.
    writeFileSync(
      join(root, 'pct/parla.config.ts'),
      `const parse = (source: string) => ({
  type: 'message',
  declarations: [],
  pattern: source
    .split(/%(\\w+)%/)
    .map((part, i) => (i % 2 ? { type: 'expression', arg: { type: 'variable', name: part } } : part)),
});
const parseFile = (text: string) => Object.fromEntries([text.trim().split(' = ')]);
export default {
  locales: ['en', 'it'],
  formats: { pct: { name: 'pct', parse, parseFile } },
  namespaces: { pct: { format: 'pct', path: 'locales/{locale}/pct.properties' } },
};
`,
    );
    const plugin = parla({ configs: ['pct/parla.config.ts'] });
    const { find } = only(plugin.placeholders);
    expect(find('Hi %name%')).toStrictEqual([]);
    await only(plugin.localeFinders).find(finderContext([]));
    expect(find('Hi %name%').map((p) => p.name)).toStrictEqual(['name']);
    expect(find('Ciao %nome%').map((p) => p.name)).toStrictEqual(['nome']);
  });
});
