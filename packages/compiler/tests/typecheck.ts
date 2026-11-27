import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../..', import.meta.url));

/** Type-checks `include` in `dir` as an app would: tsc's errors, or '' when there are none. */
export function typecheck(
  dir: string,
  {
    include = ['src'],
    skipLibCheck = false,
  }: { include?: Array<string>; skipLibCheck?: boolean } = {},
): string {
  const tsconfig = {
    compilerOptions: {
      strict: true,
      noEmit: true,
      module: 'preserve',
      moduleResolution: 'bundler',
      skipLibCheck,
      allowImportingTsExtensions: true,
      types: [],
      paths: {
        '@parlajs/core': [join(repo, 'packages/core/src/index.ts')],
        '@parlajs/react': [join(repo, 'packages/react/src/index.ts')],
        react: [join(repo, 'packages/react/node_modules/@types/react/index.d.ts')],
      },
    },
    include,
  };
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
  return spawnSync(join(repo, 'node_modules/.bin/tsc'), ['-p', join(dir, 'tsconfig.json')], {
    encoding: 'utf8',
  }).stdout;
}
