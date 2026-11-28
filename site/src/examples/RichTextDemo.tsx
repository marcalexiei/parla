'use client';
import { useParla } from '@parlajs/react';
import type { ReactNode } from 'react';

import { home } from '../parla/namespaces/home.js';

import { Demo } from './Demo.tsx';

const link = (children: ReactNode): ReactNode => <a href="#terms">{children}</a>;
const underline = (children: ReactNode): ReactNode => <u>{children}</u>;
const mark = (children: ReactNode): ReactNode => <mark>{children}</mark>;

function Terms(): ReactNode {
  const { t } = useParla([home]);
  return (
    <>
      <output>{t.home.terms({ link })}</output>
      <output>{t.home.terms({ link: underline, strong: mark })}</output>
    </>
  );
}

export function RichTextDemo(): ReactNode {
  return (
    <Demo>
      <Terms />
    </Demo>
  );
}
