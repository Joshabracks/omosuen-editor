/** DOM helpers for State Street v2.4+ `:preserve` hosts. */

export interface PreservedHTMLElement extends HTMLElement {
  moveTo(target: Element): void;
  resetLocation(): void;
}

export function asPreserved(el: Element | null): PreservedHTMLElement | null {
  if (!el || !(el instanceof HTMLElement)) return null;
  const candidate = el as PreservedHTMLElement;
  if (typeof candidate.moveTo !== 'function') return null;
  return candidate;
}

export function getPreservedById(id: string): PreservedHTMLElement | null {
  return asPreserved(document.getElementById(id));
}
