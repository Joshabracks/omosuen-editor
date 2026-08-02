/**
 * Add-component palette domains (matches V1 VS Code submenu groupings).
 */

export interface ComponentDomainGroup {
  readonly id: string;
  readonly label: string;
  readonly types: readonly string[];
}

/** Built-in domain order — unknown registered types fall into Other. */
export const COMPONENT_DOMAIN_GROUPS: readonly ComponentDomainGroup[] = [
  {
    id: 'core',
    label: 'Core',
    types: ['nexus', 'transform', 'sprite', 'camera', 'viewport'],
  },
  {
    id: 'physics',
    label: 'Physics',
    types: ['collider', 'event-collider', 'light'],
  },
  {
    id: 'behavior',
    label: 'Behavior',
    types: ['timer', 'messenger', 'input-controller', 'speed-dial'],
  },
  {
    id: 'media',
    label: 'Media',
    types: [
      'audio-track',
      'audio-player',
      'audio-effect',
      'animation-controller',
      'animation-map',
    ],
  },
  {
    id: 'system',
    label: 'System',
    types: [
      'ui-overlay',
      'data-layer',
      'flag-manager',
      'texture-map',
      'atlas-manager',
      'cell-map',
    ],
  },
];

export function formatComponentTypeLabel(type: string): string {
  return type
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Group addable types into domain submenus. Empty domains are omitted.
 * Types not listed in a known domain appear under Other.
 */
export function groupAddableTypesByDomain(
  addableTypes: readonly string[],
): readonly ComponentDomainGroup[] {
  const remaining = new Set(addableTypes);
  const groups: ComponentDomainGroup[] = [];

  for (const domain of COMPONENT_DOMAIN_GROUPS) {
    const types = domain.types.filter((type) => remaining.delete(type));
    if (types.length === 0) continue;
    groups.push({ id: domain.id, label: domain.label, types });
  }

  if (remaining.size > 0) {
    groups.push({
      id: 'other',
      label: 'Other',
      types: [...remaining].sort((a, b) => a.localeCompare(b)),
    });
  }

  return groups;
}
