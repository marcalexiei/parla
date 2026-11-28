import { createParla } from '@parlajs/react';

import { catalog } from '../parla/catalog.js';

// One instance for every example on a page, so switching locale in one switches them all.
export const parla = createParla({
  catalog,
  markup: { strong: (children) => <strong>{children}</strong> },
});
