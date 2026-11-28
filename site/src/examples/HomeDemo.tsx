'use client';
import { useParla } from '@parlajs/react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { home } from '../parla/namespaces/home.js';

import { Demo } from './Demo.tsx';

const link = (children: ReactNode): ReactNode => <a href="#terms">{children}</a>;

function Cart(): ReactNode {
  const { t } = useParla([home]);
  const [count, setCount] = useState(3);
  return (
    <>
      <output>{t.home.greeting({ name: 'Ada' })}</output>
      <div className="parla-demo-row">
        <label>
          count
          <input
            type="number"
            min={0}
            value={count}
            onChange={({ target }) => {
              setCount(target.valueAsNumber || 0);
            }}
          />
        </label>
        <output>{t.home.cart.items({ count })}</output>
      </div>
      <output>{t.home.terms({ link })}</output>
    </>
  );
}

export function HomeDemo(): ReactNode {
  return (
    <Demo>
      <Cart />
    </Demo>
  );
}
