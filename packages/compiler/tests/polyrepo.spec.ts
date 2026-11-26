import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { build } from '../src/build.ts';
import { loadConfig } from '../src/config.ts';

const root = fileURLToPath(new URL('../../../.tmp/polyrepo-test', import.meta.url));
const store = join(root, 'node_modules/.pnpm');

function put(file: string, content: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(content));
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
    put(join(root, 'parla.config.json'), { packages: ['@acme/ui', '@acme/form'] });
  });

  it('resolves dependencies of installed packages beside their real path, once each', () => {
    const base = publish('@acme/base', '1.0.0', 'base');
    const ui = publish('@acme/ui', '1.0.0', 'common', ['@acme/base']);
    const form = publish('@acme/form', '1.0.0', 'form', ['@acme/base']);
    link(deps(ui), '@acme/base', base);
    link(deps(form), '@acme/base', base);
    link(join(root, 'node_modules'), '@acme/ui', ui);
    link(join(root, 'node_modules'), '@acme/form', form);

    const config = loadConfig(root);
    expect(config.namespaces.map((ns) => `${ns.name}:${ns.owner}`).toSorted()).toStrictEqual([
      'base:@acme/base',
      'common:@acme/ui',
      'form:@acme/form',
    ]);
    const { diagnostics } = build({ cwd: root });
    expect(diagnostics).toStrictEqual([]);
  });

  it('rejects two installed versions of the package that owns a namespace', () => {
    const ui = publish('@acme/ui', '1.0.0', 'common', ['@acme/base']);
    const form = publish('@acme/form', '1.0.0', 'form', ['@acme/base']);
    link(deps(ui), '@acme/base', publish('@acme/base', '1.0.0', 'base'));
    link(deps(form), '@acme/base', publish('@acme/base', '2.0.0', 'base'));
    link(join(root, 'node_modules'), '@acme/ui', ui);
    link(join(root, 'node_modules'), '@acme/form', form);

    expect(() => loadConfig(root)).toThrow(
      /Two copies of "@acme\/base" provide namespace "base" \(.*1\.0\.0.*, .*2\.0\.0.*\)/u,
    );
  });

  it('hints at "files" when a published package lacks a catalog', () => {
    const ui = publish('@acme/ui', '1.0.0', 'common');
    rmSync(join(ui, 'locales'), { recursive: true });
    link(join(root, 'node_modules'), '@acme/ui', ui);
    link(join(root, 'node_modules'), '@acme/form', publish('@acme/form', '1.0.0', 'form'));

    const { diagnostics } = build({ cwd: root, write: false });
    expect(diagnostics.map((d) => d.message)).toContainEqual(
      expect.stringContaining('does "@acme/ui" publish it (package.json "files")?'),
    );
  });
});
