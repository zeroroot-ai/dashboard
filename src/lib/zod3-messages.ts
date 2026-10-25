/**
 * The default error texts of zod 3.25.76 (`locales/en`).
 *
 * Zod 4 changed these defaults. A user sees them in forms, so the schemas
 * that had no explicit message pass one of these strings to keep the text
 * the same as before the move to zod 4.
 */

/** A string longer than `max`. */
export const stringTooLong = (max: number): string => `String must contain at most ${max} character(s)`;

/** A string shorter than `min`. */
export const stringTooShort = (min: number): string => `String must contain at least ${min} character(s)`;

/** A float where an integer is required. */
export const NOT_AN_INTEGER = "Expected integer, received float";

/** A value that does not coerce to a number. */
export const NOT_A_NUMBER = "Expected number, received nan";

/**
 * The text for a value outside a `z.enum`, built the way zod 3 built it.
 * A string gets the enum text. Any other type gets the type text.
 */
export const invalidEnumValue = (options: readonly string[], received: unknown): string => {
  const list = options.map((o) => `'${o}'`).join(" | ");
  if (typeof received === "string") {
    return `Invalid enum value. Expected ${list}, received '${received}'`;
  }
  return `Expected ${list}, received ${received === null ? "null" : typeof received}`;
};
