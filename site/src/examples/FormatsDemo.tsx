'use client';
import { useParla } from '@parlajs/react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { formats } from '../parla/namespaces/formats.js';

import { Demo } from './Demo.tsx';

const when = new Date(2026, 11, 24, 18, 30);

function Formats(): ReactNode {
  const { t } = useParla([formats]);
  const [n, setN] = useState(1234.5);
  return (
    <>
      <div className="parla-demo-row">
        <label>
          value
          <input
            type="number"
            step="any"
            value={n}
            onChange={({ target }) => {
              setN(target.valueAsNumber || 0);
            }}
          />
        </label>
      </div>
      <div className="parla-demo-grid">
        <div>
          <output>{t.formats.price({ amount: n })}</output>
          <output>{t.formats.discount({ rate: n / 10_000 })}</output>
          <output>{t.formats.distance({ km: n })}</output>
          <output>{t.formats.weight({ kg: n })}</output>
          <output>{t.formats.views({ views: n * 1000 })}</output>
        </div>
        <div>
          <output>{t.formats.day({ when })}</output>
          <output>{t.formats.time({ when })}</output>
          <output>{t.formats.stamp({ when })}</output>
        </div>
      </div>
    </>
  );
}

export function FormatsDemo(): ReactNode {
  return (
    <Demo>
      <Formats />
    </Demo>
  );
}
