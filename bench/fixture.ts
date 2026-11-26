import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const LOCALES = ['en', 'it', 'de'] as const;

/** One message per kind `runtime.bench.ts` formats, in MF2. */
const KINDS = {
  plain: 'Welcome back',
  interpolated: 'Hello {$name}, you have {$count} new messages',
  plural: '.input {$count :number}\n.match $count\none {{{$count} item}}\n* {{{$count} items}}',
  select:
    '.input {$gender :string}\n.match $gender\nfemale {{She replied}}\nmale {{He replied}}\n* {{They replied}}',
  number: 'Total {$amount :currency currency=EUR}',
  date: 'Updated {$when :date}',
  rich: 'Accept the {#link}terms{/link} and the {#bold}privacy policy{/bold}',
};

/** The same kinds in ICU, so the compiler parses both formats. */
const ICU_KINDS = [
  'Welcome back',
  'Hello {name}, you have {count} new messages',
  '{count, plural, one {# item} other {# items}}',
  '{gender, select, female {She replied} male {He replied} other {They replied}}',
  'Total {amount, number}',
  '<link>terms</link> and <bold>privacy policy</bold>',
];

const MF2_KINDS = Object.values(KINDS);

// Enough to time the compiler; one group is past V8's 127-key literal limit.
const FILLER_NAMESPACES = 12;
const FILLER_KEYS = 400;

/** `{ "section3": { "key42": … } }`, with `section0` holding the 160 keys that split. */
function fillerCatalog(kinds: ReadonlyArray<string>, locale: string): object {
  const out: Record<string, Record<string, string>> = {};
  for (let i = 0; i < FILLER_KEYS; i += 1) {
    const section = `section${i < 160 ? 0 : 1 + (i % 5)}`;
    out[section] ??= {};
    const kind = kinds[i % kinds.length] ?? '';
    // MF2 complex messages start with `.`, so only simple ones take the prefix.
    out[section][`key${i}`] = kind.startsWith('.') ? kind : `[${locale}] ${kind}`;
  }
  return out;
}

function put(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** Writes the catalogs and `parla.config.ts` to `dir`, emptied first. */
export function writeFixture(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  const namespaces: Record<string, { format: string; path: string }> = {
    bench: { format: 'mf2', path: 'locales/{locale}/bench.json' },
  };
  for (let n = 0; n < FILLER_NAMESPACES; n += 1) {
    const format = n % 2 === 0 ? 'mf2' : 'icu';
    namespaces[`filler${n}`] = { format, path: `locales/{locale}/filler${n}.json` };
    for (const locale of LOCALES) {
      const catalog = fillerCatalog(format === 'mf2' ? MF2_KINDS : ICU_KINDS, locale);
      put(join(dir, `locales/${locale}/filler${n}.json`), JSON.stringify(catalog));
    }
  }
  for (const locale of LOCALES) {
    put(join(dir, `locales/${locale}/bench.json`), JSON.stringify(KINDS));
  }
  put(
    join(dir, 'parla.config.ts'),
    `export default ${JSON.stringify({ locales: LOCALES, sourceLocale: 'en', namespaces, runtime: '@parlajs/core' })};\n`,
  );
  put(join(dir, 'package.json'), '{ "type": "module" }\n');
}
