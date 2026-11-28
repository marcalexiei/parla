import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Diagnostic } from '../src/build.ts';
import { runCommand } from '../src/command.ts';
import type { CommandRun } from '../src/command.ts';

const tmp = fileURLToPath(new URL('../../../.tmp/command-test', import.meta.url));
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

function put(file: string, content: unknown): void {
  const path = join(tmp, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

const CONFIG = `export default ${JSON.stringify({
  locales: ['en', 'it'],
  namespaces: { app: { format: 'icu', path: 'locales/{locale}/app.json' } },
})};\n`;

/** `app` in en and it: it leaves out `b` and `c`, and has `old`, which en does not. */
function fixture(): void {
  rmSync(tmp, { recursive: true, force: true });
  put('parla.config.ts', CONFIG);
  put('locales/en/app.json', { a: 'A', b: 'B', c: 'C' });
  put('locales/it/app.json', { a: 'A', old: 'Vecchio' });
}

const MISSING =
  'warning [missing-translation] app › it › b, c: untranslated, using "en" (locales/it/app.json)';
const UNKNOWN =
  'warning [unknown-key] app › it › old: not in "en", so dropped: add it there or remove it (locales/it/app.json)';

/** Runs `parla <args>` in the fixture, keeping what it prints. */
async function parla(
  ...args: Array<string>
): Promise<{ run: CommandRun; out: Array<string>; err: Array<string> }> {
  const out: Array<string> = [];
  const err: Array<string> = [];
  const run = await runCommand(args, {
    cwd: tmp,
    log: (line) => {
      out.push(line);
    },
    error: (line) => {
      err.push(line);
    },
  });
  return { run, out, err };
}

/** A summary line, its timing left out. */
const summary = (line: string | undefined): string => (line ?? '').replace(/ · \d+ms/, '');

describe('parla', () => {
  it('prints help, and fails on a missing or unknown command', async () => {
    fixture();
    const help = await parla('--help');
    expect(help.run.code).toBe(0);
    expect(help.out[0]).toMatch(/^Usage: parla <command>/);
    const none = await parla();
    expect(none.run.code).toBe(1);
    const unknown = await parla('deploy');
    expect(unknown.run.code).toBe(1);
    expect(unknown.out[0]).toMatch(/^Usage/);
  });

  it('explains an unknown option in one line', async () => {
    fixture();
    const { run, out, err } = await parla('build', '--fast');
    expect(run.code).toBe(1);
    expect(out).toStrictEqual([]);
    expect(err).toHaveLength(1);
    expect(err[0]).toMatch(/^parla: Unknown option '--fast'/);
  });

  it('checks without writing: one line per problem, then a summary', async () => {
    fixture();
    const { run, out } = await parla('check');
    expect(run.code).toBe(0);
    expect(out.slice(0, -1)).toStrictEqual([UNKNOWN, MISSING]);
    expect(summary(out.at(-1))).toBe(
      'parla check: 1 namespaces × 2 locales · 0 errors · 2 warnings',
    );
    expect(existsSync(join(tmp, 'src'))).toBe(false);
  });

  it('fails on warnings with --strict', async () => {
    fixture();
    const warned = await parla('check', '--strict');
    expect(warned.run.code).toBe(1);
    put('locales/it/app.json', { a: 'A', b: 'B', c: 'C' });
    const clean = await parla('check', '--strict');
    expect(clean.run.code).toBe(0);
  });

  it('prints every diagnostic as JSON, one per key', async () => {
    fixture();
    const { run, out } = await parla('check', '--json');
    expect(run.code).toBe(0);
    expect(out).toHaveLength(1);
    const diagnostics = JSON.parse(out[0] ?? '') as Array<Diagnostic>;
    expect(diagnostics.map((d) => `${d.code}:${d.key ?? ''}`)).toStrictEqual([
      'unknown-key:old',
      'missing-translation:b',
      'missing-translation:c',
    ]);
  });

  it('builds, and fails on a catalog error', async () => {
    fixture();
    const built = await parla('build');
    expect(built.run.code).toBe(0);
    expect(summary(built.out.at(-1))).toMatch(/^parla build: .* · 2 warnings · 6 files written$/);
    put('locales/en/app.json', { a: 'A', b: 'B', c: '{oops' });
    const broken = await parla('build');
    expect(broken.run.code).toBe(1);
    expect(broken.out[0]).toMatch(/^error {3}\[invalid-syntax\] app › en › c:/);
    expect(summary(broken.out.at(-1))).toMatch(/· 1 errors · 2 warnings · 3 files written$/);
  });

  it('reads the config named by -c, and explains one it cannot load', async () => {
    fixture();
    put('other/parla.config.ts', "export default { locales: ['en'] };\n");
    const other = await parla('check', '-c', 'other/parla.config.ts');
    expect(summary(other.out.at(-1))).toBe(
      'parla check: 0 namespaces × 1 locales · 0 errors · 0 warnings',
    );
    rmSync(join(tmp, 'parla.config.ts'));
    const missing = await parla('check');
    expect(missing.run.code).toBe(1);
    expect(missing.err).toStrictEqual([`parla: No parla.config.ts in ${tmp}`]);
  });

  it('watches only with build', async () => {
    fixture();
    const { run, out } = await parla('check', '--watch');
    expect(out.some((l) => l.startsWith('parla: watching'))).toBe(false);
    run.close();
  });
});

/** Long enough for a rebuild that should not happen. */
const settle = async (): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, 300);
  });
};

const isSummary = (line: string): boolean => line.startsWith('parla build:');

/**
 * Writes `file` until a rebuild prints its summary, as a write before the watcher is ready goes
 * unseen; then the lines since, summaries left out, and the last summary.
 */
async function edit(
  out: Array<string>,
  writes: Record<string, unknown>,
): Promise<{ lines: Array<string>; last: string }> {
  const from = out.length;
  await vi.waitFor(
    () => {
      for (const [file, content] of Object.entries(writes)) {
        put(file, content);
      }
      expect(out.slice(from).some((line) => isSummary(line))).toBe(true);
    },
    { timeout: 5000, interval: 150 },
  );
  await settle();
  const since = out.slice(from);
  return {
    lines: since.filter((line) => !isSummary(line)),
    last: summary(since.findLast((line) => isSummary(line))),
  };
}

describe('parla build --watch', { timeout: 20_000 }, () => {
  let watching: CommandRun | undefined;
  afterEach(() => {
    watching?.close();
    watching = undefined;
  });

  it('repeats no warning, and ignores files that are not catalogs', async () => {
    fixture();
    const { run, out, err } = await parla('build', '--watch');
    watching = run;
    expect(run.code).toBe(0);
    expect(out.slice(0, 2)).toStrictEqual([UNKNOWN, MISSING]);
    expect(out.at(-1)).toBe('parla: watching 3 folders');

    // the same problems: only the summary
    let edited = await edit(out, { 'locales/it/app.json': { a: 'Uno', old: 'Vecchio' } });
    expect(edited.lines).toStrictEqual([]);
    expect(edited.last).toMatch(/· 2 warnings · \d+ files written$/);

    // a new problem: only its key
    edited = await edit(out, { 'locales/it/app.json': { old: 'Vecchio' } });
    expect(edited.lines).toStrictEqual([
      'warning [missing-translation] app › it › a: untranslated, using "en" (locales/it/app.json)',
    ]);

    // a file beside the catalogs: no rebuild
    const from = out.length;
    put('locales/it/notes.txt', 'not a catalog');
    await settle();
    expect(out.slice(from)).toStrictEqual([]);

    // a broken config: one error, not repeated by other saves, and still watching
    await vi.waitFor(
      () => {
        put('parla.config.ts', 'throw new Error("boom");\n');
        expect(err).toHaveLength(1);
      },
      { timeout: 5000, interval: 150 },
    );
    expect(err[0]).toMatch(/^parla: Cannot load .*parla\.config\.ts: boom$/);
    put('parla.config.ts', 'throw new Error("boom"); // again\n');
    await settle();
    put('parla.config.ts', 'throw new Error("boom"); // and again\n');
    await settle();
    expect(err).toHaveLength(1);
    edited = await edit(out, {
      'parla.config.ts': CONFIG,
      'locales/it/app.json': { a: 'A', b: 'B', c: 'C' },
    });
    expect(edited.last).toMatch(/· 0 warnings/);
  });
});

/** Runs the bin itself, as a terminal would. */
const bin = (...args: Array<string>): { code: number | null; stdout: string; stderr: string } => {
  const ran = spawnSync(process.execPath, ['--conditions=@parlajs/source', cli, ...args], {
    cwd: tmp,
    encoding: 'utf8',
  });
  return { code: ran.status, stdout: ran.stdout, stderr: ran.stderr };
};

describe('the parla bin', () => {
  it('prints to the terminal and exits with the code', () => {
    fixture();
    const ok = bin('check');
    expect(ok.code).toBe(0);
    expect(ok.stdout.split('\n').slice(0, 2)).toStrictEqual([UNKNOWN, MISSING]);
    const strict = bin('check', '--strict');
    expect(strict.code).toBe(1);
    const bad = bin('check', '--fast');
    expect(bad.code).toBe(1);
    expect(bad.stderr).toMatch(/^parla: Unknown option '--fast'/);
  });
});
