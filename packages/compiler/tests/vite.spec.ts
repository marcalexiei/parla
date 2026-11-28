import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build as viteBuild, createBuilder, createLogger, createServer } from 'vite';
import type { Logger, Rolldown, ViteDevServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parla } from '../src/vite.ts';

/** A `parla.config.ts` exporting `config`. */
const configModule = (config: object): string =>
  `export default ${JSON.stringify(config, null, 2)};\n`;

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
  put(
    join(dir, 'parla.config.ts'),
    configModule({
      locales: ['en'],
      namespaces: Object.fromEntries(
        Object.entries(namespaces).map(([ns, folder]) => [
          ns,
          { format: 'icu', path: `${folder}/{locale}/${ns}.json` },
        ]),
      ),
    }),
  );
}

/** The generated chunk of `ns`, or '' before it exists. */
function chunk(dir: string, ns: string, locale = 'en'): string {
  const file = join(dir, 'src/parla/messages', locale, `${ns}.js`);
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

/** A logger that keeps warnings in `lines` and parla's errors in `errors`. */
function capture(): { logger: Logger; lines: Array<string>; errors: Array<string> } {
  const lines: Array<string> = [];
  const errors: Array<string> = [];
  const logger = createLogger('silent');
  logger.warn = (msg): void => {
    lines.push(msg);
  };
  logger.error = (msg): void => {
    if (msg.includes('parla')) {
      errors.push(msg);
    }
  };
  return { logger, lines, errors };
}

/** `app` in en and it, where it leaves out `missing`. */
function partly(missing: Array<string>, title = 'Uno'): void {
  put(
    join(app, 'parla.config.ts'),
    configModule({
      locales: ['en', 'it'],
      namespaces: { app: { format: 'icu', path: 'locales/{locale}/app.json' } },
    }),
  );
  put(join(app, 'locales/en/app.json'), { title: 'One', a: 'A', b: 'B' });
  put(
    join(app, 'locales/it/app.json'),
    Object.fromEntries(
      Object.entries({ title, a: 'A', b: 'B' }).filter(([k]) => !missing.includes(k)),
    ),
  );
}

describe('the Vite plugin warns once', { timeout: 20_000 }, () => {
  let server: ViteDevServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('per problem across dev rebuilds', async () => {
    rmSync(tmp, { recursive: true, force: true });
    partly(['a']);
    put(join(app, 'index.html'), '<script type="module" src="/main.js"></script>');
    put(join(app, 'main.js'), '');
    const { logger, lines } = capture();
    server = await createServer({
      root: app,
      logLevel: 'silent',
      customLogger: logger,
      server: { port: 0, ws: false },
      plugins: [parla()],
    });
    await server.listen();
    const warning =
      '[parla] warning [missing-translation] app › it › a: untranslated, using "en" (locales/it/app.json)';
    expect(lines).toStrictEqual([warning]);
    await writeUntil(join(app, 'locales/it/app.json'), { title: 'Due', b: 'B' }, () => {
      expect(chunk(app, 'app', 'it')).toContain('Due');
    });
    expect(lines).toStrictEqual([warning]);
    await writeUntil(join(app, 'locales/it/app.json'), { title: 'Tre' }, () => {
      expect(chunk(app, 'app', 'it')).toContain('Tre');
    });
    expect(lines).toStrictEqual([warning, warning.replace('› a:', '› b:')]);
  });

  it('per problem across build environments', async () => {
    rmSync(tmp, { recursive: true, force: true });
    partly(['a', 'b']);
    put(join(app, 'client.js'), 'export const client = 1;');
    put(join(app, 'server.js'), 'export const server = 1;');
    const { logger, lines } = capture();
    const builder = await createBuilder({
      root: app,
      logLevel: 'silent',
      customLogger: logger,
      plugins: [parla()],
      builder: {},
      environments: {
        client: { build: { outDir: 'dist/client', rolldownOptions: { input: 'client.js' } } },
        ssr: { build: { outDir: 'dist/ssr', ssr: 'server.js' } },
      },
    });
    await builder.buildApp();
    expect(lines).toStrictEqual([
      '[parla] warning [missing-translation] app › it › a, b: untranslated, using "en" (locales/it/app.json)',
    ]);
  });

  it('reports errors as errors in dev, and a config that breaks', async () => {
    rmSync(tmp, { recursive: true, force: true });
    partly([]);
    put(join(app, 'index.html'), '<script type="module" src="/main.js"></script>');
    put(join(app, 'main.js'), '');
    const { logger, lines, errors } = capture();
    server = await createServer({
      root: app,
      logLevel: 'silent',
      customLogger: logger,
      server: { port: 0, ws: false },
      plugins: [parla()],
    });
    await server.listen();
    await writeUntil(join(app, 'locales/it/app.json'), { title: '{oops', a: 'A', b: 'B' }, () => {
      expect(errors).toHaveLength(1);
    });
    expect(errors[0]).toMatch(/^\[parla\] error {3}\[invalid-syntax\] app › it › title:/);
    await writeUntil(join(app, 'parla.config.ts'), 'throw new Error("boom");\n', () => {
      expect(errors).toHaveLength(2);
    });
    expect(errors[1]).toMatch(/^parla: Cannot load .*parla\.config\.ts: boom$/);
    // another save, as broken: nothing more
    put(join(app, 'parla.config.ts'), 'throw new Error("boom"); // still\n');
    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
    expect(errors).toHaveLength(2);
    expect(lines).toStrictEqual([]);
  });

  it('fails a build on catalog errors, printed once', async () => {
    rmSync(tmp, { recursive: true, force: true });
    partly([]);
    put(join(app, 'locales/en/app.json'), { title: '{oops', a: 'A', b: 'B' });
    put(join(app, 'main.js'), 'export const x = 1;');
    const { logger, errors } = capture();
    await expect(
      viteBuild({
        root: app,
        logLevel: 'silent',
        customLogger: logger,
        plugins: [parla()],
        build: { lib: { entry: 'main.js', formats: ['es'], fileName: 'main' } },
      }),
    ).rejects.toThrow('parla: catalog errors, see above');
    expect(errors.filter((line) => line.startsWith('[parla]'))).toHaveLength(1);
  });
});
