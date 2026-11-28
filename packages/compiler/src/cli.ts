#!/usr/bin/env node
import { watch } from 'node:fs';
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

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: 'string', short: 'c' },
    watch: { type: 'boolean', short: 'w' },
    strict: { type: 'boolean' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const [command] = positionals;
if (values.help || !command || !['build', 'check'].includes(command)) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

const write = command === 'build';
const fresh = unreported();

async function run(): Promise<{ failed: boolean; files: Array<string> }> {
  const started = performance.now();
  const result = await build({ config: values.config, write });
  const { diagnostics, config } = result;
  const reports = formatDiagnostics(diagnostics);
  const errors = reports.filter((r) => r.level === 'error').length;
  const warnings = reports.length - errors;
  if (values.json) {
    console.log(JSON.stringify(diagnostics, null, 2));
  } else {
    for (const { line } of formatDiagnostics(fresh(diagnostics), config.root)) {
      console.log(line);
    }
  }
  const ms = Math.round(performance.now() - started);
  const summary = `${config.namespaces.length} namespaces × ${config.locales.length} locales · ${errors} errors · ${warnings} warnings · ${ms}ms`;
  if (!values.json) {
    console.log(
      `parla ${command}: ${summary}${write ? ` · ${result.written.length} files written` : ''}`,
    );
  }
  return {
    failed: errors > 0 || (Boolean(values.strict) && warnings > 0),
    files: config.watchFiles,
  };
}

async function rebuild(): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(`parla: ${(error as Error).message}`);
  }
}

try {
  const first = await run();
  if (!values.watch || !write) {
    process.exit(first.failed ? 1 : 0);
  }
  let timer: NodeJS.Timeout | undefined;
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void rebuild();
    }, 50);
  };
  const dirs = new Set(first.files.map((f) => dirname(f)));
  const files = new Set(first.files);
  for (const dir of dirs) {
    watch(dir, (_, name) => {
      // a folder holds more than catalogs; `name` is null where the platform does not tell
      if (name === null || files.has(join(dir, name))) {
        schedule();
      }
    });
  }
  console.log(`parla: watching ${dirs.size} folders`);
} catch (error) {
  console.error(`parla: ${(error as Error).message}`);
  process.exit(1);
}
