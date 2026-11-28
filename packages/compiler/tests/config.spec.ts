import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ConfigError, defineConfig, loadConfig } from '../src/config.ts';

const dir = fileURLToPath(new URL('../../../.tmp/config-test', import.meta.url));

async function configWith(config: object): Promise<unknown> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'parla.config.ts'), `export default ${JSON.stringify(config)};`);
  return loadConfig(dir);
}

const ns = (name: string): object => ({ [name]: { format: 'icu', path: 'l/{locale}.json' } });

describe(loadConfig, () => {
  it('accepts the names it writes files for', async () => {
    await expect(
      configWith({ locales: ['en', 'pt-BR', 'zh-Hant-TW'], namespaces: ns('admin_user.v2-beta') }),
    ).resolves.toBeDefined();
  });

  it.each(['../evil', 'a/b', String.raw`a\b`, '..', '.hidden', ''])(
    'rejects the namespace name %j, which would write outside outDir',
    async (name) => {
      await expect(configWith({ namespaces: ns(name) })).rejects.toThrow(ConfigError);
    },
  );

  it.each(['../en', 'en/x', '', 'en us'])('rejects the locale %j, not a tag', async (locale) => {
    await expect(configWith({ locales: [locale], sourceLocale: locale })).rejects.toThrow(
      /is not a locale tag/,
    );
  });

  it('reads TypeScript, and an edit on the next load', async () => {
    await configWith({ locales: ['en'] });
    writeFileSync(
      join(dir, 'parla.config.ts'),
      "const locales: Array<string> = ['en', 'it'];\nexport default { locales };\n",
    );
    const config = await loadConfig(dir);
    expect(config.locales).toStrictEqual(['en', 'it']);
  });

  it.each([
    [{ locales: ['it'] }, 'sourceLocale "en" is not in locales'],
    [{ namespaces: { app: { format: 'icu', path: 'app.json' } } }, 'path must contain {locale}'],
  ])('rejects %j', async (config, message) => {
    await expect(configWith(config)).rejects.toThrow(message);
  });

  it('types a config without changing it', () => {
    const config = { locales: ['en'] };
    expect(defineConfig(config)).toBe(config);
  });

  it('explains a folder without a config', async () => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    await expect(loadConfig(dir)).rejects.toThrow(`No parla.config.ts in ${dir}`);
  });

  it('explains a config without a default export', async () => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'parla.config.ts'), 'export const locales = ["en"];\n');
    await expect(loadConfig(dir)).rejects.toThrow(/must `export default defineConfig/);
  });

  it('names a config that throws, as a ConfigError', async () => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'parla.config.ts');
    writeFileSync(file, 'throw new Error("boom");\n');
    const failed = loadConfig(dir);
    await expect(failed).rejects.toThrow(`Cannot load ${file}: boom`);
    await expect(failed).rejects.toBeInstanceOf(ConfigError);
  });
});
