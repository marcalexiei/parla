#!/usr/bin/env node
import { runCommand } from './command.ts';

const { code } = await runCommand(process.argv.slice(2), {
  cwd: process.cwd(),
  log: console.log,
  error: console.error,
});
process.exitCode = code;
