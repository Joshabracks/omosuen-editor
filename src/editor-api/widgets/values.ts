/**
 * Pure value mappers for inspector widgets → property values.
 */

export function applyStringEdit(_current: unknown, next: string): string {
  return next;
}

export function applyNumberEdit(
  _current: unknown,
  raw: string,
): number | null {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

export function applyBooleanEdit(_current: unknown, checked: boolean): boolean {
  return checked;
}

export function applyEnumEdit(
  raw: string,
  opts: { numeric?: boolean; nullable?: boolean },
): string | number | null {
  if (opts.nullable && raw === '') return null;
  if (opts.numeric) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return raw;
}

export function applyVectorAxisEdit(
  current: unknown,
  axis: string,
  raw: string,
): Record<string, number> | null {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  const base =
    typeof current === 'object' && current !== null && !Array.isArray(current)
      ? { ...(current as Record<string, number>) }
      : {};
  return { ...base, [axis]: n };
}

export function applyStringSetToggle(
  current: unknown,
  member: string,
  checked: boolean,
  alwaysOn: readonly string[] = [],
): string[] {
  const set = new Set<string>();
  if (Array.isArray(current)) {
    for (const v of current) if (typeof v === 'string') set.add(v);
  }
  for (const m of alwaysOn) set.add(m);
  if (checked) set.add(member);
  else if (!alwaysOn.includes(member)) set.delete(member);
  return Array.from(set);
}

export function applyListAdd(
  current: unknown,
  emptyItem: unknown = '',
): unknown[] {
  const list = Array.isArray(current) ? [...current] : [];
  list.push(emptyItem);
  return list;
}

export function applyListRemove(current: unknown, index: number): unknown[] {
  const list = Array.isArray(current) ? [...current] : [];
  if (index < 0 || index >= list.length) return list;
  list.splice(index, 1);
  return list;
}

export function applyListItemEdit(
  current: unknown,
  index: number,
  raw: string,
): unknown[] {
  const list = Array.isArray(current) ? [...current] : [];
  if (index < 0 || index >= list.length) return list;
  try {
    list[index] = JSON.parse(raw) as unknown;
  } catch {
    list[index] = raw;
  }
  return list;
}

export function applyMapAdd(
  current: unknown,
  key = '',
  value: unknown = '',
): Record<string, unknown> {
  const map =
    typeof current === 'object' && current !== null && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  let nextKey = key;
  let i = 1;
  while (nextKey === '' || Object.prototype.hasOwnProperty.call(map, nextKey)) {
    nextKey = key || `key${i}`;
    i += 1;
    if (key && !Object.prototype.hasOwnProperty.call(map, key) && key !== '') {
      nextKey = key;
      break;
    }
    if (i > 1000) break;
  }
  if (key && !Object.prototype.hasOwnProperty.call(map, key)) {
    map[key] = value;
  } else {
    map[nextKey] = value;
  }
  return map;
}

export function applyMapRemove(
  current: unknown,
  key: string,
): Record<string, unknown> {
  const map =
    typeof current === 'object' && current !== null && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  delete map[key];
  return map;
}

export function applyMapEntries(
  entries: readonly { key: string; value: string }[],
): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const row of entries) {
    if (!row.key) continue;
    try {
      map[row.key] = JSON.parse(row.value) as unknown;
    } catch {
      map[row.key] = row.value;
    }
  }
  return map;
}

export function applyObjectJsonEdit(raw: string): unknown | undefined {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** Read a possibly dotted property from a component-like object. */
export function getNestedProperty(
  target: unknown,
  path: string,
): unknown {
  if (!path) return undefined;
  const parts = path.split('.');
  let cur: unknown = target;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Immutably set a possibly dotted property. */
export function setNestedProperty(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const parts = path.split('.');
  if (parts.length === 1) {
    return { ...target, [path]: value };
  }
  const [head, ...rest] = parts;
  const child =
    typeof target[head!] === 'object' &&
    target[head!] !== null &&
    !Array.isArray(target[head!])
      ? { ...(target[head!] as Record<string, unknown>) }
      : {};
  return {
    ...target,
    [head!]: setNestedProperty(child, rest.join('.'), value),
  };
}
