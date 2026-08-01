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
  registry: DockViewRegistry,
): void {
  const placeholders: Array<{ id: ViewId; title: string; body: string }> = [
    { id: 'empty-a', title: 'Scene Tree', body: 'Placeholder A — scene tree' },
    { id: 'empty-b', title: 'Viewport', body: 'Placeholder B — authoring viewport' },
    { id: 'empty-c', title: 'Inspector', body: 'Placeholder C — inspector' },
  ];

  for (const p of placeholders) {
    registry.register({
      id: p.id,
      title: p.title,
      mount: (container) => {
        container.classList.add('dock-view-placeholder');
        container.innerHTML = `<h2>${p.title}</h2><p>${p.body}</p>`;
      },
    });
  }
}
