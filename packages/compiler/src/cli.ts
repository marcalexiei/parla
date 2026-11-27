#!/usr/bin/env node
import { watch } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';

import { build, formatDiagnostic } from './build.ts';
import type { BuildOptions } from './build.ts';

const HELP = `Usage: parla <command> [options]

Commands
  build    Compile catalogs into per-locale chunks and typed accessors
  types    Write only the .d.ts files (for workspace packages)
  check    Validate catalogs without writing anything

Options
  -c, --config <file>   Config file (default: parla.config.ts or package.json "parla")
  -w, --watch           Rebuild on change (build, types)
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
if (values.help || !command || !['build', 'types', 'check'].includes(command)) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

const WRITE: Record<string, BuildOptions['write']> = { build: 'all', types: 'types', check: false };
const write = WRITE[command] ?? false;

async function run(): Promise<{ failed: boolean; files: Array<string> }> {
  const started = performance.now();
  const result = await build({ config: values.config, write });
  const { diagnostics, config } = result;
  const errors = diagnostics.filter((d) => d.level === 'error').length;
  const warnings = diagnostics.length - errors;
  if (values.json) {
    console.log(JSON.stringify(diagnostics, null, 2));
  } else {
    for (const d of diagnostics) {
      console.log(formatDiagnostic(d, config.root));
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
  for (const dir of dirs) {
    watch(dir, schedule);
  }
  console.log(`parla: watching ${dirs.size} folders`);
} catch (error) {
  console.error(`parla: ${(error as Error).message}`);
  process.exit(1);
}
