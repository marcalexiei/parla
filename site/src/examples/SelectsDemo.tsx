'use client';
import { useParla } from '@parlajs/react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { shopIcu } from '../parla/namespaces/shopIcu.js';
import { shopMf2 } from '../parla/namespaces/shopMf2.js';

import { Demo } from './Demo.tsx';

const day = new Date(2026, 11, 24);

function Shop(): ReactNode {
  const { t } = useParla([shopIcu, shopMf2]);
  const [count, setCount] = useState(1);
  const [place, setPlace] = useState(2);
  const [method, setMethod] = useState<'pickup' | 'courier' | 'other'>('pickup');
  const delivery = { method, store: 'Milano Centrale', courier: 'Rita', day };
  const column = (shop: typeof t.shopIcu | typeof t.shopMf2): ReactNode => (
    <>
      <output>{shop.items({ count })}</output>
      <output>{shop.rank({ place })}</output>
      <output>{shop.delivery(delivery)}</output>
    </>
  );
  return (
    <>
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
        <label>
          place
          <input
            type="number"
            min={1}
            value={place}
            onChange={({ target }) => {
              setPlace(target.valueAsNumber || 1);
            }}
          />
        </label>
        <label>
          method
          <select
            value={method}
            onChange={({ target }) => {
              setMethod(target.value as typeof method);
            }}>
            <option>pickup</option>
            <option>courier</option>
            <option>other</option>
          </select>
        </label>
      </div>
      <div className="parla-demo-grid">
        <div>
          <h4>ICU</h4>
          {column(t.shopIcu)}
        </div>
        <div>
          <h4>MF2</h4>
          {column(t.shopMf2)}
        </div>
      </div>
    </>
  );
}

export function SelectsDemo(): ReactNode {
  return (
    <Demo>
      <Shop />
    </Demo>
  );
}
