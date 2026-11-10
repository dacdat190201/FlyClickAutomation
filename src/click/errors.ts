export type ClickErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAVAILABLE'
  | 'UNSUPPORTED'
  | 'NO_TARGET'
  | 'DUPLICATE'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'REJECTED'
  | 'VERIFICATION_FAILED'
  | 'ADAPTER_ERROR';

export class ClickError extends Error {
  readonly code: ClickErrorCode;
  /** True only when it is safe to try again without risking a second click. */
  readonly retryable: boolean;

  constructor(
    code: ClickErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'ClickError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

/** Anything an adapter throws that is not already a ClickError: outcome unknown, so not retryable. */
export function toClickError(error: unknown): ClickError {
  if (error instanceof ClickError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ClickError('ADAPTER_ERROR', message, { cause: error });
}
