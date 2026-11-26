import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from '../src/config.ts';

const dir = fileURLToPath(new URL('../../../.tmp/config-test', import.meta.url));

function configWith(config: object): () => unknown {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'parla.config.json'), JSON.stringify(config));
  return () => loadConfig(dir);
}

const ns = (name: string): object => ({ [name]: { format: 'icu', path: 'l/{locale}.json' } });

describe(loadConfig, () => {
  it('accepts the names it writes files for', () => {
    expect(
      configWith({ locales: ['en', 'pt-BR', 'zh-Hant-TW'], namespaces: ns('admin_user.v2-beta') }),
    ).not.toThrow();
  });

  it.each(['../evil', 'a/b', String.raw`a\b`, '..', '.hidden', ''])(
    'rejects the namespace name %j, which would write outside outDir',
    (name) => {
      expect(configWith({ namespaces: ns(name) })).toThrow(ConfigError);
    },
  );

  it.each(['../en', 'en/x', '', 'en us'])('rejects the locale %j, not a tag', (locale) => {
    expect(configWith({ locales: [locale], sourceLocale: locale })).toThrow(/is not a locale tag/);
  });
});
