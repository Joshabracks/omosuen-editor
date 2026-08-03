/**
 * Add-component palette helpers.
 */

export function formatComponentTypeLabel(type: string): string {
  return type
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Flat alphabetical list for the Add Component menu. */
export function sortAddableTypesAlpha(
  addableTypes: readonly string[],
): string[] {
  return [...addableTypes].sort((a, b) => a.localeCompare(b));
}
