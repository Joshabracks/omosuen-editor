import type { ViewId } from './types';

export interface DockViewRegistration {
  readonly id: ViewId;
  readonly title: string;
  /** Mount view UI into `container`. Optional dispose when unregistered. */
  readonly mount: (container: HTMLElement) => void | (() => void);
}

export class DockViewRegistry {
  private readonly views = new Map<ViewId, DockViewRegistration>();

  register(view: DockViewRegistration): void {
    if (this.views.has(view.id)) {
      throw new Error(`View already registered: ${view.id}`);
    }
    this.views.set(view.id, view);
  }

  get(id: ViewId): DockViewRegistration | undefined {
    return this.views.get(id);
  }

  list(): DockViewRegistration[] {
    return [...this.views.values()];
  }
}

export function registerPlaceholderViews(
  _registry: DockViewRegistry,
): void {
  // All Phase 0–4 shell views are real mounts (see registerShellViews).
}
