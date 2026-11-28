import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// React picks its server build, without `createContext`, only in a process started with the condition.
const script = `
import * as entry from '@parlajs/react';
import { createElement, Fragment, isValidElement } from 'react';

const notes = {
  name: 'notes',
  load: {
    en: async () => ({
      default: (rt) => ({ hi: (p) => rt.rich(['A ', rt.tag(p, 'b', ['bold'])]), plain: () => 'Plain' }),
    }),
  },
};
const parla = entry.createParla({ catalog: { locales: ['en'], sourceLocale: 'en' } });
const { notes: t } = await parla.load([notes]);
const node = t.hi({ b: (children) => createElement('b', null, children) });
console.log(JSON.stringify({
  exports: Object.keys(entry).sort(),
  rich: isValidElement(node) && node.type === Fragment,
  bold: node.props.children[1].type,
  plain: t.plain(),
}));
`;

describe('the react-server condition', () => {
  it('imports without hooks, and renders rich text as React nodes', () => {
    const run = spawnSync(
      process.execPath,
      [
        '--conditions=react-server',
        '--conditions=@parlajs/source',
        '--input-type=module',
        '-e',
        script,
      ],
      { cwd: join(import.meta.dirname, '..'), encoding: 'utf8' },
    );
    expect(run.stderr).toBe('');
    expect(JSON.parse(run.stdout)).toStrictEqual({
      exports: ['createParla', 'createRuntime', 'matchLocale', 'parseAcceptLanguage'],
      rich: true,
      bold: 'b',
      plain: 'Plain',
    });
  });
});
