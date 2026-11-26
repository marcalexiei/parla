import { describe, expect, it } from 'vitest';

import { ab, sides } from './sides.ts';

declare module 'vitest' {
  interface TaskMeta {
    /** Read by `scripts/bench-summary.ts`. */
    gzip?: Record<string, number>;
  }
}

/** Bytes are deterministic, so this only leaves room for a deliberate addition. */
const SIZE_DELTA = 0.02;

describe('compiler', () => {
  it('build a large catalog', async ({ bench }) => {
    // A rebuild with nothing changed, as in watch mode: every catalog is read, parsed and compiled.
    await ab(
      bench,
      (side) => async (): Promise<unknown> => side.compiler.build({ cwd: side.dir }),
      {
        prime: 3,
        iterations: 20,
      },
    );
  });

  it('generated chunks, gzipped', ({ task }) => {
    const gzip = Object.fromEntries(sides.map((side) => [side.name, side.gzip]));
    task.meta.gzip = gzip;
    expect(gzip['branch']).toBeLessThanOrEqual((gzip['main'] ?? Infinity) * (1 + SIZE_DELTA));
  });
});
