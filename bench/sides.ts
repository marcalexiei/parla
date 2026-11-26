import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { expect } from 'vitest';
import type { Bench, BenchFn, BenchRunOptions } from 'vitest';

import type { build, formatDiagnostic } from '../packages/compiler/src/index.ts';
import type { Catalog, createParla, Loader, MessageModule } from '../packages/core/src/index.ts';

import { writeFixture } from './fixture.ts';

interface Core {
  readonly createParla: typeof createParla;
}

interface Compiler {
  readonly build: typeof build;
  readonly formatDiagnostic: typeof formatDiagnostic;
}

/** One checkout's packages, and the fixture its compiler built. */
export interface Side {
  readonly name: 'main' | 'branch';
  readonly core: Core;
  readonly compiler: Compiler;
  readonly dir: string;
  /** Every chunk imported up front, so a load times Parla rather than the module loader. */
  readonly catalog: Catalog;
  /** Gzipped bytes of every generated chunk. */
  readonly gzip: number;
}

/** How much slower than `main` the branch's median may be before it fails. */
const DELTA = 0.25;

const repo = fileURLToPath(new URL('..', import.meta.url));

const importFrom = async <T>(file: string): Promise<T> =>
  (await import(pathToFileURL(file).href)) as T;

async function prepare(name: Side['name'], root: string): Promise<Side> {
  // The two cores are separate on purpose; without this the second warns about the first.
  Reflect.deleteProperty(globalThis, Symbol.for('parlajs.core'));
  const core = await importFrom<Core>(join(root, 'packages/core/src/index.ts'));
  const compiler = await importFrom<Compiler>(join(root, 'packages/compiler/src/index.ts'));

  const dir = join(repo, '.tmp/bench', name);
  writeFixture(dir);
  const { diagnostics } = await compiler.build({ cwd: dir });
  if (diagnostics.length > 0) {
    throw new Error(diagnostics.map((d) => compiler.formatDiagnostic(d)).join('\n'));
  }

  const out = join(dir, 'src/parla');
  const built = await importFrom<{ catalog: Catalog }>(join(out, 'catalog.js'));
  const namespaces: Record<string, Record<string, Loader>> = {};
  for (const [ns, perLocale] of Object.entries(built.catalog.namespaces)) {
    namespaces[ns] = {};
    for (const [locale, loader] of Object.entries(perLocale)) {
      const mod = await loader();
      namespaces[ns][locale] = async (): Promise<MessageModule> => Promise.resolve(mod);
    }
  }

  let gzip = 0;
  for (const file of readdirSync(join(out, 'messages'), { recursive: true, encoding: 'utf8' })) {
    if (file.endsWith('.js')) {
      gzip += gzipSync(readFileSync(join(out, 'messages', file))).length;
    }
  }

  return { name, core, compiler, dir, catalog: { ...built.catalog, namespaces }, gzip };
}

/** The branch, then `main` from the checkout `PARLA_BASE` points at, when it is set and builds. */
async function loadSides(): Promise<Array<Side>> {
  const branch = await prepare('branch', repo);
  const base = process.env['PARLA_BASE'];
  if (!base) {
    return [branch];
  }
  try {
    return [await prepare('main', resolve(base)), branch];
  } catch (error) {
    // An API change on the branch can leave `main` unable to run these benches.
    console.warn(`main skipped: ${(error as Error).message}`);
    return [branch];
  }
}

export const sides: Array<Side> = await loadSides();

/**
 * Benches `make(side)` for each side, and fails if the branch is more than `DELTA` slower than
 * `main`. Both sides share the call sites in `make`, so each is primed with the other's feedback.
 */
export async function ab(
  bench: Bench,
  make: (side: Side) => BenchFn | Promise<BenchFn>,
  options: BenchRunOptions & { prime?: number } = {},
): Promise<void> {
  const { prime = 100, ...run } = options;
  const fns: Array<[Side['name'], BenchFn]> = [];
  for (const side of sides) {
    try {
      fns.push([side.name, await make(side)]);
    } catch (error) {
      if (side.name === 'branch') {
        throw error;
      }
      console.warn(`main skipped: ${(error as Error).message}`);
    }
  }
  for (let i = 0; i < prime; i += 1) {
    for (const [, fn] of fns) {
      await fn();
    }
  }
  const [first, second] = fns.map(([name, fn]) => bench(name, fn));
  if (!first || !second) {
    await first?.run(run);
    return;
  }
  const result = await bench.compare(first, second, run);
  // The median, as a GC pause landing in one side moves the mean.
  const [main, branch] = [result.get('main').latency.p50, result.get('branch').latency.p50];
  expect(
    branch,
    `branch ${((branch / main - 1) * 100).toFixed(1)}% slower than main`,
  ).toBeLessThanOrEqual(main * (1 + DELTA));
}
