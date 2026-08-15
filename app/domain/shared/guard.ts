// Guard clauses for enforcing invariants at construction/boundary points. Return
// Result so callers can choose to throw or handle. Part of the shared kernel.
import { err, ok, type Result } from "./result";

export const Guard = {
  againstNullOrUndefined<T>(value: T | null | undefined, name: string): Result<T> {
    return value === null || value === undefined ? err(`${name} is required`) : ok(value);
  },

  againstEmpty(value: string | null | undefined, name: string): Result<string> {
    return !value || value.trim().length === 0 ? err(`${name} must not be empty`) : ok(value);
  },

  inRange(value: number, min: number, max: number, name: string): Result<number> {
    return value < min || value > max ? err(`${name} must be between ${min} and ${max}`) : ok(value);
  },

  oneOf<T extends string>(value: string, allowed: readonly T[], name: string): Result<T> {
    return (allowed as readonly string[]).includes(value)
      ? ok(value as T)
      : err(`${name} must be one of ${allowed.join(", ")}`);
  },
};
