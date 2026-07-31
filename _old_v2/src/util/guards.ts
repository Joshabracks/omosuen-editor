/**
 * Shared runtime type guards.
 *
 * Kept minimal: only add a guard here when it's used in two or more
 * modules. One-off narrowing belongs next to its call site.
 */

/**
 * Narrow an unknown value to a plain record (an object with string keys
 * and unknown values). Typical use: JSON-derived values that need a
 * structural check before per-field validation.
 *
 * Rejects `null` (typeof `'object'` but not a record), arrays, and all
 * primitives.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
