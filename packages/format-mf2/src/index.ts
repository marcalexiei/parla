import { MessageSyntaxError, parseMessage, validate } from 'messageformat';
import type { Model } from 'messageformat';

export type { Model } from 'messageformat';

export interface FormatAdapter {
  /** Format id used in catalog config, e.g. `mf2`. */
  name: string;
  /** Parses one message source into the MessageFormat 2 data model. Throws {@link FormatError}. */
  readonly parse: (source: string) => Model.Message;
}

export class FormatError extends Error {
  readonly start: number | undefined;
  readonly end: number | undefined;

  constructor(message: string, start?: number, end?: number) {
    super(message);
    this.start = start;
    this.end = end;
    this.name = 'FormatError';
  }
}

export const mf2: FormatAdapter = {
  name: 'mf2',
  parse(source) {
    let msg: Model.Message;
    try {
      msg = parseMessage(source);
      validate(msg);
    } catch (error) {
      if (error instanceof MessageSyntaxError) {
        throw new FormatError(`MF2 ${error.type} at ${error.start}`, error.start, error.end);
      }
      throw error;
    }
    return msg;
  },
};
