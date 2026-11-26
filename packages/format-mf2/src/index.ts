import { parseMessage, validate } from 'messageformat';
import type { MessageSyntaxError, Model } from 'messageformat';

/** The compiler's `mf2` format: parses and validates one message, or throws. */
export const mf2 = {
  name: 'mf2',
  parse: (source: string): Model.Message => {
    try {
      const msg = parseMessage(source);
      validate(msg);
      return msg;
    } catch (error) {
      // Both throw only syntax errors, data model ones included.
      const { type, start } = error as MessageSyntaxError;
      throw new Error(`MF2 ${type} at ${start}`, { cause: error });
    }
  },
};
