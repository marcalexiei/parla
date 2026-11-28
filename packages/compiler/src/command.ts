import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

import { build, formatDiagnostics, unreported } from './build.ts';

const HELP = `Usage: parla <command> [options]

Commands
  build    Compile catalogs into per-locale chunks and typed namespace objects
  check    Validate catalogs without writing anything

Options
  -c, --config <file>   Config file (default: parla.config.ts)
  -w, --watch           Rebuild on change (build)
      --strict          Treat warnings as errors
      --json            Print diagnostics as JSON (check)
  -h, --help`;

export interface CommandIO {
  readonly cwd: string;
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
}

export interface CommandRun {
  readonly code: number;
  /** Stops watching; a no-op unless `--watch`. */
  readonly close: () => void;
}

const done = (code: number): CommandRun => ({
  code,
  close: () => {
    // nothing to stop
  },
});

/** Runs `parla <args>`: the exit code, and in watch mode the watchers that keep it running. */
export async function runCommand(
  args: ReadonlyArray<string>,
  { cwd, log, error }: CommandIO,
): Promise<CommandRun> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      options: {
        config: { type: 'string', short: 'c' },
        watch: { type: 'boolean', short: 'w' },
        strict: { type: 'boolean' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error_) {
    error(`parla: ${(error_ as Error).message}`);
    return done(1);
  }
  const { values, positionals } = parsed;
  const [command] = positionals;
  if (values.help || !command || !['build', 'check'].includes(command)) {
    log(HELP);
    return done(values.help ? 0 : 1);
  }

  const write = command === 'build';
  const fresh = unreported();

  const run = async (): Promise<{ failed: boolean; files: Array<string> }> => {
    const started = performance.now();
    const result = await build({ cwd, config: values.config, write });
    const { diagnostics, config } = result;
    const reports = formatDiagnostics(diagnostics);
    const errors = reports.filter((r) => r.level === 'error').length;
    const warnings = reports.length - errors;
    if (values.json) {
      log(JSON.stringify(diagnostics, null, 2));
    } else {
      for (const { line } of formatDiagnostics(fresh(diagnostics), config.root)) {
        log(line);
      }
      const ms = Math.round(performance.now() - started);
      const files = write ? ` · ${result.written.length} files written` : '';
      log(
        `parla ${command}: ${config.namespaces.length} namespaces × ${config.locales.length} locales · ${errors} errors · ${warnings} warnings · ${ms}ms${files}`,
      );
    }
    return {
      failed: errors > 0 || (Boolean(values.strict) && warnings > 0),
      files: config.watchFiles,
    };
  };

  let first;
  try {
    first = await run();
  } catch (error_) {
    error(`parla: ${(error_ as Error).message}`);
    return done(1);
  }
  const code = first.failed ? 1 : 0;
  if (!values.watch || !write) {
    return done(code);
  }

  let timer: NodeJS.Timeout | undefined;
  // a save that leaves the config as broken as before repeats nothing
  let failure: string | undefined;
  const rebuild = async (): Promise<void> => {
    try {
      await run();
      failure = undefined;
    } catch (error_) {
      const line = `parla: ${(error_ as Error).message}`;
      if (line !== failure) {
        error(line);
      }
      failure = line;
    }
  };
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void rebuild();
    }, 50);
  };
  const files = new Set(first.files);
  const dirs = new Set(first.files.map((f) => dirname(f)));
  const watchers: Array<FSWatcher> = [...dirs].map((dir) =>
    watch(dir, (_, name) => {
      // a folder holds more than catalogs; `name` is null where the platform does not tell
      if (name === null || files.has(join(dir, name))) {
        schedule();
      }
    }),
  );
  log(`parla: watching ${dirs.size} folders`);
  return {
    code,
    close: () => {
      clearTimeout(timer);
      for (const watcher of watchers) {
        watcher.close();
      }
    },
  };
}
