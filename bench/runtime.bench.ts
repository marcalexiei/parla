import { describe, it } from 'vitest';

import { ab } from './sides.ts';
import type { Side } from './sides.ts';

type Markup = (children: unknown) => unknown;

/** The `bench` namespace of `fixture.ts`. */
interface Messages {
  plain: () => string;
  interpolated: (p: { name: string; count: number }) => string;
  plural: (p: { count: number }) => string;
  select: (p: { gender: string }) => string;
  number: (p: { amount: number }) => string;
  date: (p: { when: Date }) => string;
  rich: (p: { link: Markup; bold: Markup }) => unknown;
}

const when = new Date(Date.UTC(2026, 10, 26));
const wrap: Markup = (children) => children;

const CALLS: Record<keyof Messages, (m: Messages) => unknown> = {
  plain: (m) => m.plain(),
  interpolated: (m) => m.interpolated({ name: 'Ada', count: 3 }),
  plural: (m) => m.plural({ count: 3 }),
  select: (m) => m.select({ gender: 'female' }),
  number: (m) => m.number({ amount: 1234.5 }),
  date: (m) => m.date({ when }),
  rich: (m) => m.rich({ link: wrap, bold: wrap }),
};

async function loaded(side: Side): Promise<Messages> {
  const parla = side.core.createParla({ catalog: side.catalog });
  const t = await parla.load(['bench']);
  return t['bench'] as Messages;
}

// A call takes nanoseconds, so a sample makes enough of them that the timer's resolution is noise.
const BATCH = 1000;

describe('runtime', () => {
  it('cold start: createParla, load two namespaces, first message', async ({ bench }) => {
    await ab(bench, (side) => async (): Promise<void> => {
      const parla = side.core.createParla({ catalog: side.catalog });
      const t = await parla.load(['bench', 'filler0']);
      (t['bench'] as Messages).plural({ count: 3 });
    });
  });

  it.for(Object.entries(CALLS))(`format: %s ×${BATCH}`, async ([, call], { bench }) => {
    await ab(bench, async (side) => {
      const messages = await loaded(side);
      return (): void => {
        for (let i = 0; i < BATCH; i += 1) {
          call(messages);
        }
      };
    });
  });

  it(`locale switch with namespaces loaded ×${BATCH}`, async ({ bench }) => {
    await ab(bench, async (side) => {
      const parla = side.core.createParla({ catalog: side.catalog });
      await parla.load(['bench', 'filler0']);
      await parla.setLocale('it');
      await parla.load(['bench', 'filler0']);
      return async (): Promise<void> => {
        for (let i = 0; i < BATCH; i += 1) {
          await parla.setLocale(parla.locale === 'en' ? 'it' : 'en');
        }
      };
    });
  });
});
