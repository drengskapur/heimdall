// Result — a typed success/failure without throwing. Domain and application code
// return Result for fallible operations (parsing, validation) so callers handle
// both paths explicitly. Part of the shared kernel (seedwork).

export type Result<T, E = string> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok;
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok;

/** Unwrap the value or fall back. */
export const unwrapOr = <T, E>(result: Result<T, E>, fallback: T): T => (result.ok ? result.value : fallback);

/** Map the success value, preserving errors. */
export const mapResult = <T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> =>
  result.ok ? ok(fn(result.value)) : result;
