import { MessageSyntaxError, parseMessage, validate, type Model } from 'messageformat';

export type { Model };

export interface FormatAdapter {
  /** Format id used in catalog config, e.g. `mf2`. */
  name: string;
  /** Parses one message source into the MessageFormat 2 data model. Throws {@link FormatError}. */
  parse(source: string): Model.Message;
}

export class FormatError extends Error {
  constructor(
    message: string,
    readonly start?: number,
    readonly end?: number,
  ) {
    super(message);
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

export default mf2;
