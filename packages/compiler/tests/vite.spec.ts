import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build as viteBuild, createServer } from 'vite';
import type { Rolldown, ViteDevServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parla } from '../src/vite.ts';

const tmp = fileURLToPath(new URL('../../../.tmp/vite-test', import.meta.url));
const app = join(tmp, 'app');

function put(file: string, content: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

/** Writes the config in `dir`: `app` in `locales/`, plus `extra` in a folder of its own. */
function catalog(dir: string, withExtra: boolean): void {
  const namespaces: Record<string, string> = withExtra
    ? { app: 'locales', extra: 'more/locales' }
    : { app: 'locales' };
  put(join(dir, 'parla.config.json'), {
    locales: ['en'],
    namespaces: Object.fromEntries(
      Object.entries(namespaces).map(([ns, folder]) => [
        ns,
        { format: 'icu', path: `${folder}/{locale}/${ns}.json` },
      ]),
    ),
  });
}

/** The generated chunk of `ns`, or '' before it exists. */
function chunk(dir: string, ns: string): string {
  const file = join(dir, 'src/parla/messages/en', `${ns}.js`);
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

/** Retries `assertion` while the watcher catches up. */
async function eventually(assertion: () => void): Promise<void> {
  await vi.waitFor(assertion, { timeout: 5000, interval: 50 });
}

/** Rewrites `file` until `assertion` passes: a write before the watcher is ready goes unseen. */
async function writeUntil(file: string, content: unknown, assertion: () => void): Promise<void> {
  await vi.waitFor(
    () => {
      put(file, content);
      assertion();
    },
    { timeout: 5000, interval: 100 },
  );
}

/** Edits a message, then adds a namespace in a folder that did not exist at start. */
async function editAndAdd(dir: string): Promise<void> {
  await writeUntil(join(dir, 'locales/en/app.json'), { title: 'Two' }, () => {
    expect(chunk(dir, 'app')).toContain('Two');
  });
  catalog(dir, true);
  const extra = join(dir, 'more/locales/en/extra.json');
  await writeUntil(extra, { hello: 'Added' }, () => {
    expect(chunk(dir, 'extra')).toContain('Added');
  });
  await writeUntil(extra, { hello: 'Changed' }, () => {
    expect(chunk(dir, 'extra')).toContain('Changed');
  });
}

// Three waits of up to 5 s each, so a missed rebuild fails its own wait, not the test timeout
describe('the Vite plugin, so `parla build --watch` is not needed', { timeout: 20_000 }, () => {
  let server: ViteDevServer | undefined;
  let watcher: Rolldown.RolldownWatcher | undefined;

  afterEach(async () => {
    await server?.close();
    await watcher?.close();
    server = undefined;
    watcher = undefined;
  });

  it.each([
    ['in the Vite root', app],
    ['in a folder outside it', join(tmp, 'i18n')],
  ])('rebuilds in the dev server, catalog %s', async (_, dir) => {
    rmSync(tmp, { recursive: true, force: true });
    catalog(dir, false);
    put(join(dir, 'locales/en/app.json'), { title: 'One' });
    put(join(app, 'index.html'), '<script type="module" src="/main.js"></script>');
    put(join(app, 'main.js'), '');

    server = await createServer({
      root: app,
      logLevel: 'silent',
      server: { port: 0, ws: false },
      plugins: [parla(dir === app ? {} : { root: dir })],
    });
    await server.listen();
    expect(chunk(dir, 'app')).toContain('One');
    await editAndAdd(dir);
  });

  it('rebuilds in `vite build --watch`', async () => {
    rmSync(tmp, { recursive: true, force: true });
    catalog(app, false);
    put(join(app, 'locales/en/app.json'), { title: 'One' });
    put(join(app, 'main.js'), "export { catalog } from './src/parla/catalog.js';");

    watcher = (await viteBuild({
      root: app,
      logLevel: 'silent',
      plugins: [parla()],
      build: { watch: {}, lib: { entry: 'main.js', formats: ['es'], fileName: 'main' } },
    })) as Rolldown.RolldownWatcher;
    await eventually(() => {
      expect(chunk(app, 'app')).toContain('One');
    });
    await editAndAdd(app);
  });
});
