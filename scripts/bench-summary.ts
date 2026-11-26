#!/usr/bin/env node
/**
 * @file The bench's JSON report as a markdown table, `main` against the branch, for the CI job
 * summary: `node scripts/bench-summary.ts report.json >> "$GITHUB_STEP_SUMMARY"`.
 */

import { readFileSync } from 'node:fs';

interface Task {
  name: string;
  latency: { p50: number };
  throughput: { p50: number };
}

interface Report {
  testResults: Array<{
    assertionResults: Array<{
      title: string;
      status: string;
      meta: { gzip?: Record<string, number> };
      benchmarks?: Array<{ tasks: Array<Task> }>;
    }>;
  }>;
}

const [file] = process.argv.slice(2);
if (!file) {
  console.error('usage: bench-summary.ts <report.json>');
  process.exit(1);
}

const report = JSON.parse(readFileSync(file, 'utf8')) as Report;

const ops = (n: number): string => Math.round(n).toLocaleString('en-US');
const change = (main: number, branch: number): string =>
  `${branch >= main ? '+' : ''}${((branch / main - 1) * 100).toFixed(1)}%`;

const rows: Array<string> = [];
let compared = false;
for (const { assertionResults } of report.testResults) {
  for (const { title, status, meta, benchmarks } of assertionResults) {
    const mark = status === 'passed' ? '' : ' ❌';
    const tasks = new Map(benchmarks?.[0]?.tasks.map((t) => [t.name, t]));
    const [main, branch] = [tasks.get('main'), tasks.get('branch')];
    const { gzip } = meta;
    if (branch) {
      compared ||= main !== undefined;
      const cells = main
        ? [ops(main.throughput.p50), change(main.latency.p50, branch.latency.p50)]
        : ['', ''];
      rows.push(`| ${title}${mark} | ${cells[0]} | ${ops(branch.throughput.p50)} | ${cells[1]} |`);
    } else if (gzip?.['branch'] !== undefined) {
      const { main: before, branch: after } = gzip;
      const cells = before === undefined ? ['', ''] : [`${ops(before)} B`, change(before, after)];
      rows.push(`| ${title}${mark} | ${cells[0]} | ${ops(after)} B | ${cells[1]} |`);
    }
  }
}

console.log(
  [
    '## Benchmarks',
    '',
    compared
      ? 'Median ops/s, or bytes. Change is in time or size: lower is better.'
      : 'Median ops/s, or bytes. `main` could not run these benches, so nothing was compared.',
    '',
    '| | main | branch | change |',
    '| --- | ---: | ---: | ---: |',
    ...rows,
  ].join('\n'),
);
