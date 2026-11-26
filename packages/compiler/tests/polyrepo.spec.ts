import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { build } from '../src/build.ts';
import { loadConfig } from '../src/config.ts';
import type { ParlaConfig } from '../src/config.ts';

/** A `parla.config.ts` exporting `config`. */
const configModule = (config: object): string =>
  `export default ${JSON.stringify(config, null, 2)};\n`;

const root = fileURLToPath(new URL('../../../.tmp/polyrepo-test', import.meta.url));
const store = join(root, 'node_modules/.pnpm');

function put(file: string, content: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
}

/** Installs `name@version` into a pnpm-style store and returns its real directory. */
function publish(
  name: string,
  version: string,
  namespace: string,
  packages: Array<string> = [],
): string {
  const dir = join(store, `${name.replace('/', '+')}@${version}/node_modules`, name);
  put(join(dir, 'package.json'), {
    name,
    version,
    parla: {
      namespaces: { [namespace]: { format: 'icu', path: 'locales/{locale}.json' } },
      packages,
    },
  });
  put(join(dir, 'locales/en.json'), { hello: `Hello from ${name}@${version}` });
  return dir;
}

/** Symlinks `target` as `name` in `nodeModules`, like pnpm does for each dependency. */
function link(nodeModules: string, name: string, target: string): void {
  const path = join(nodeModules, name);
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, 'dir');
}

const deps = (pkgDir: string): string => dirname(dirname(pkgDir));

describe(loadConfig, () => {
  beforeEach(() => {
    rmSync(root, { recursive: true, force: true });
    put(join(root, 'parla.config.ts'), configModule({ packages: ['@acme/ui', '@acme/form'] }));
  });

  it('resolves dependencies of installed packages beside their real path, once each', async () => {
    const base = publish('@acme/base', '1.0.0', 'base');
    const ui = publish('@acme/ui', '1.0.0', 'common', ['@acme/base']);
    const form = publish('@acme/form', '1.0.0', 'form', ['@acme/base']);
    link(deps(ui), '@acme/base', base);
    link(deps(form), '@acme/base', base);
    link(join(root, 'node_modules'), '@acme/ui', ui);
    link(join(root, 'node_modules'), '@acme/form', form);

    const config = await loadConfig(root);
    expect(config.namespaces.map((ns) => `${ns.name}:${ns.owner}`).toSorted()).toStrictEqual([
      'base:@acme/base',
      'common:@acme/ui',
      'form:@acme/form',
    ]);
    const { diagnostics } = await build({ cwd: root });
    expect(diagnostics).toStrictEqual([]);
  });

  it('rejects two installed versions of the package that owns a namespace', async () => {
    const ui = publish('@acme/ui', '1.0.0', 'common', ['@acme/base']);
    const form = publish('@acme/form', '1.0.0', 'form', ['@acme/base']);
    link(deps(ui), '@acme/base', publish('@acme/base', '1.0.0', 'base'));
    link(deps(form), '@acme/base', publish('@acme/base', '2.0.0', 'base'));
    link(join(root, 'node_modules'), '@acme/ui', ui);
    link(join(root, 'node_modules'), '@acme/form', form);

    await expect(loadConfig(root)).rejects.toThrow(
      /Two copies of "@acme\/base" provide namespace "base" \(.*1\.0\.0.*, .*2\.0\.0.*\)/u,
    );
  });

  it('hints at "files" when a published package lacks a catalog', async () => {
    const ui = publish('@acme/ui', '1.0.0', 'common');
    rmSync(join(ui, 'locales'), { recursive: true });
    link(join(root, 'node_modules'), '@acme/ui', ui);
    link(join(root, 'node_modules'), '@acme/form', publish('@acme/form', '1.0.0', 'form'));

    const { diagnostics } = await build({ cwd: root, write: false });
    expect(diagnostics.map((d) => d.message)).toContainEqual(
      expect.stringContaining('does "@acme/ui" publish it (package.json "files")?'),
    );
  });
});

/** A workspace package under `packages/`, linked from the root's `node_modules` as pnpm does. */
function workspace(
  name: string,
  { dependencies, packages }: Pick<ParlaConfig, 'packages'> & { dependencies?: object },
  namespaces: Array<string> = [],
): string {
  const dir = join(root, 'packages', name.split('/').pop() ?? name);
  const owned = Object.fromEntries(
    namespaces.map((ns) => [ns, { format: 'icu', path: `locales/{locale}/${ns}.json` }]),
  );
  const parla = packages || namespaces.length > 0 ? { packages, namespaces: owned } : undefined;
  put(join(dir, 'package.json'), { name, dependencies, parla });
  for (const ns of namespaces) {
    put(join(dir, `locales/en/${ns}.json`), { hello: `Hello from ${ns}` });
  }
  link(join(root, 'node_modules'), name, dir);
  return dir;
}

async function included(): Promise<Array<string>> {
  const config = await loadConfig(root);
  return config.namespaces.map((ns) => `${ns.name}:${ns.owner}`).toSorted();
}

describe('namespace subsets', () => {
  beforeEach(() => {
    rmSync(root, { recursive: true, force: true });
    workspace('@acme/i18n', {}, ['generic', 'ui', 'admin']);
  });

  it('includes the union of the subsets every path lists', async () => {
    workspace('@acme/ui', { packages: [{ name: '@acme/i18n', namespaces: ['ui'] }] });
    put(
      join(root, 'parla.config.ts'),
      configModule({ packages: [{ name: '@acme/i18n', namespaces: ['generic'] }, '@acme/ui'] }),
    );
    await expect(included()).resolves.toStrictEqual(['generic:@acme/i18n', 'ui:@acme/i18n']);
  });

  it('includes every namespace when one path lists the package by name', async () => {
    workspace('@acme/ui', { packages: ['@acme/i18n'] });
    put(
      join(root, 'parla.config.ts'),
      configModule({ packages: [{ name: '@acme/i18n', namespaces: ['generic'] }, '@acme/ui'] }),
    );
    await expect(included()).resolves.toHaveLength(3);
  });

  it('rejects a namespace the package does not own', async () => {
    put(
      join(root, 'parla.config.ts'),
      configModule({ packages: [{ name: '@acme/i18n', namespaces: ['generic', 'nope'] }] }),
    );
    await expect(loadConfig(root)).rejects.toThrow(
      'Package "@acme/i18n" does not own namespace "nope"',
    );
  });
});

describe('packages: "dependencies"', () => {
  beforeEach(() => {
    rmSync(root, { recursive: true, force: true });
    workspace('@acme/i18n', {}, ['generic', 'ui', 'admin']);
    put(join(root, 'parla.config.ts'), configModule({ packages: 'dependencies' }));
  });

  it('walks workspace dependencies through packages without a parla field', async () => {
    workspace('@acme/form', { packages: [{ name: '@acme/i18n', namespaces: ['ui'] }] }, ['form']);
    const feature = workspace('@acme/feature', { dependencies: { '@acme/form': 'workspace:*' } });
    link(
      join(root, 'node_modules'),
      '@acme/installed',
      publish('@acme/installed', '1.0.0', 'installed'),
    );
    put(join(root, 'package.json'), {
      dependencies: {
        '@acme/feature': 'workspace:*',
        '@acme/i18n': 'workspace:*',
        '@acme/installed': '1.0.0',
      },
    });

    const config = await loadConfig(root);
    // `@acme/i18n` is a dependency too, but the subset narrows it; installed packages are not walked.
    expect(config.namespaces.map((ns) => `${ns.name}:${ns.owner}`).toSorted()).toStrictEqual([
      'form:@acme/form',
      'ui:@acme/i18n',
    ]);
    expect(config.watchFiles).toContain(join(feature, 'package.json'));
  });

  it('includes every namespace of a package reached only as a dependency', async () => {
    put(join(root, 'package.json'), { dependencies: { '@acme/i18n': 'workspace:*' } });
    await expect(included()).resolves.toHaveLength(3);
  });
});
