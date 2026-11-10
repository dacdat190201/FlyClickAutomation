export class OcrError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = new.target.name;
  }
}

/** The native ML Kit module is not present (e.g. running in Expo Go instead of a dev build). */
export class OcrUnavailableError extends OcrError {}
