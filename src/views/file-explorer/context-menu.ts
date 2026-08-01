export interface ContextMenuItem {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface ContextMenuOptions {
  readonly x: number;
  readonly y: number;
  readonly items: readonly ContextMenuItem[];
  readonly onSelect: (id: string) => void;
}

/** Simple expandable context menu (portal on document.body). */
export function showContextMenu(options: ContextMenuOptions): () => void {
  dismissOpenContextMenus();

  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.setAttribute('role', 'menu');
  menu.tabIndex = -1;
  menu.innerHTML = options.items
    .map((item) => {
      const disabled = item.disabled ? ' disabled aria-disabled="true"' : '';
      return `<button type="button" class="ctx-menu-item" role="menuitem" data-id="${escapeAttr(item.id)}"${disabled}>${escapeHtml(item.label)}</button>`;
    })
    .join('');

  document.body.appendChild(menu);
  positionMenu(menu, options.x, options.y);
  menu.focus();

  const onSelect = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    const btn = target?.closest<HTMLButtonElement>('.ctx-menu-item');
    if (!btn || btn.disabled || !btn.dataset.id) return;
    const id = btn.dataset.id;
    dispose();
    options.onSelect(id);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dispose();
    }
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (menu.contains(event.target as Node)) return;
    dispose();
  };

  menu.addEventListener('click', onSelect);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('pointerdown', onPointerDown, true);

  function dispose(): void {
    menu.removeEventListener('click', onSelect);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('pointerdown', onPointerDown, true);
    menu.remove();
    if (openMenuDispose === dispose) openMenuDispose = null;
  }

  openMenuDispose = dispose;
  return dispose;
}

let openMenuDispose: (() => void) | null = null;

export function dismissOpenContextMenus(): void {
  openMenuDispose?.();
  openMenuDispose = null;
}

function positionMenu(menu: HTMLElement, x: number, y: number): void {
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const rect = menu.getBoundingClientRect();
  let left = x;
  let top = y;
  if (left + rect.width > window.innerWidth - 4) {
    left = Math.max(4, window.innerWidth - rect.width - 4);
  }
  if (top + rect.height > window.innerHeight - 4) {
    top = Math.max(4, window.innerHeight - rect.height - 4);
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
