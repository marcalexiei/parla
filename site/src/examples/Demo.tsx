'use client';
import { ParlaProvider, useLocale } from '@parlajs/react';
import type { Locale } from '@parlajs/react';
import { Suspense, useState } from 'react';
import type { ReactNode } from 'react';

import { parla } from './parla.tsx';

import './demo.css';

function Locales(): ReactNode {
  const { locale, locales, setLocale } = useLocale();
  const [pending, setPending] = useState<Locale | null>(null);
  const switchTo = async (next: Locale): Promise<void> => {
    setPending(next);
    try {
      await setLocale(next);
    } finally {
      setPending(null);
    }
  };
  return (
    <div className="parla-demo-locales" role="group" aria-label="Locale">
      {locales.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={l === locale}
          onClick={() => {
            void switchTo(l);
          }}>
          {l}
          {pending === l ? '…' : ''}
        </button>
      ))}
    </div>
  );
}

/** A live example: the provider, a locale switcher, and a fallback while chunks load. */
export function Demo({ children }: { children: ReactNode }): ReactNode {
  return (
    <ParlaProvider parla={parla}>
      <div className="parla-demo">
        <Locales />
        <Suspense fallback={<p className="parla-demo-loading">Loading…</p>}>{children}</Suspense>
      </div>
    </ParlaProvider>
  );
}
