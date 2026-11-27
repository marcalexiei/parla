import { mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createParla } from '@parlajs/core';
import type { Parla } from '@parlajs/core';
import { build as viteBuild } from 'vite';
import { beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { build } from '../src/build.ts';

const root = fileURLToPath(new URL('../../../.tmp/workspace-test', import.meta.url));

function put(file: string, content: unknown): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

/** Links `dir` as `name` in `nodeModules`, as pnpm does for a workspace package. */
function link(nodeModules: string, name: string, dir: string): void {
  const path = join(root, nodeModules, name);
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(join(root, dir), path, 'dir');
}

const NAMESPACES = ['common', 'checkout', 'profile', 'admin'];
const catalog = { locales: ['en', 'it'], sourceLocale: 'en' };

/** `@utils/i18n` owns every namespace and builds them once, in its own folder. */
async function owner(dir: string, version: string): Promise<void> {
  put(`${dir}/package.json`, { name: '@utils/i18n', version, type: 'module' });
  put(
    `${dir}/parla.config.ts`,
    `export default ${JSON.stringify({
      locales: catalog.locales,
      runtime: '@parlajs/core',
      namespaces: Object.fromEntries(
        NAMESPACES.map((ns) => [ns, { format: 'icu', path: `locales/{locale}/${ns}.json` }]),
      ),
    })};\n`,
  );
  for (const ns of NAMESPACES) {
    put(`${dir}/locales/en/${ns}.json`, { title: `${ns}:en:${version}` });
    put(`${dir}/locales/it/${ns}.json`, { title: `${ns}:it:${version}` });
  }
  const built = await build({ cwd: join(root, dir) });
  expect(built.diagnostics).toStrictEqual([]);
}

/** A feature package imports the namespaces it reads, each from its own module, and builds nothing. */
function feature(name: string, namespaces: Array<string>): void {
  put(`node_modules/@feature/${name}/package.json`, {
    name: `@feature/${name}`,
    type: 'module',
    exports: { '.': './index.js' },
  });
  const imports = namespaces
    .map((ns) => `import { ${ns} } from '@utils/i18n/src/parla/namespaces/${ns}.js';\n`)
    .join('');
  const list = namespaces.join(', ');
  put(
    `node_modules/@feature/${name}/index.js`,
    `${imports}export async function ${name}(parla) {\n  const t = await parla.load([${list}]);\n  return [${namespaces.map((ns) => `t.${ns}.title()`).join(', ')}];\n}\n`,
  );
}

interface Bundle {
  /** Output files holding a message chunk, by the message they hold. */
  chunks: Map<string, Array<string>>;
  run: (parla: Parla) => Promise<Record<string, () => Promise<Array<string>>>>;
}

async function bundle(entry: string, out: string): Promise<Bundle> {
  await viteBuild({
    root,
    logLevel: 'silent',
    build: {
      outDir: out,
      emptyOutDir: true,
      minify: false,
      lib: { entry, formats: ['es'], fileName: 'main' },
    },
  });
  const chunks = new Map<string, Array<string>>();
  for (const file of readdirSync(join(root, out), { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.js')) {
      continue;
    }
    for (const { groups } of readFileSync(join(root, out, file), 'utf8').matchAll(
      /"title": \(p\) => "(?<title>[^"]+)"/g,
    )) {
      const title = groups?.['title'] ?? '';
      chunks.set(title, [...(chunks.get(title) ?? []), file]);
    }
  }
  return {
    chunks,
    run: async (parla) => {
      const mod = (await import(pathToFileURL(join(root, out, 'main.js')).href)) as Record<
        string,
        (p: Parla) => Promise<Array<string>>
      >;
      return Object.fromEntries(Object.entries(mod).map(([k, fn]) => [k, async () => fn(parla)]));
    },
  };
}

describe('a workspace whose owner package builds the namespace objects', () => {
  beforeAll(async () => {
    rmSync(root, { recursive: true, force: true });
    await owner('packages/i18n', '1');
    link('node_modules', '@utils/i18n', 'packages/i18n');
    feature('cart', ['checkout', 'common']);
    feature('account', ['profile', 'common']);
    put(
      'app.js',
      "export { cart } from '@feature/cart';\nexport { account } from '@feature/account';\n",
    );
  });

  it('bundles the chunks of the imported namespaces only, a shared one once', async () => {
    const { chunks, run } = await bundle('app.js', 'dist');
    expect([...chunks.keys()].toSorted()).toStrictEqual([
      'checkout:en:1',
      'checkout:it:1',
      'common:en:1',
      'common:it:1',
      'profile:en:1',
      'profile:it:1',
    ]);
    expect([...chunks.values()].every((files) => files.length === 1)).toBe(true);

    const parla = createParla({ catalog });
    const app = await run(parla);
    await expect(app['cart']?.()).resolves.toStrictEqual(['checkout:en:1', 'common:en:1']);
    await expect(app['account']?.()).resolves.toStrictEqual(['profile:en:1', 'common:en:1']);
    await parla.setLocale('it');
    await expect(app['cart']?.()).resolves.toStrictEqual(['checkout:it:1', 'common:it:1']);
  });

  it('bundles a second copy of the owner twice, and the runtime uses the first', async () => {
    await owner('packages/i18n-v2', '2');
    link('node_modules/@feature/legacy/node_modules', '@utils/i18n', 'packages/i18n-v2');
    feature('legacy', ['common']);
    put(
      'legacy-app.js',
      "export { cart } from '@feature/cart';\nexport { legacy } from '@feature/legacy';\n",
    );
    const { chunks, run } = await bundle('legacy-app.js', 'dist-legacy');
    expect([...chunks.keys()].filter((t) => t.startsWith('common:en'))).toStrictEqual([
      'common:en:1',
      'common:en:2',
    ]);

    const warn = vi.spyOn(console, 'warn').mockReturnValue();
    onTestFinished(() => {
      warn.mockRestore();
    });
    const app = await run(createParla({ catalog }));
    await expect(app['cart']?.()).resolves.toStrictEqual(['checkout:en:1', 'common:en:1']);
    await expect(app['legacy']?.()).resolves.toStrictEqual(['common:en:1']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/two namespace objects are named "common"/),
    );
  });
});
