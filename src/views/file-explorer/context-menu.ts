export interface ContextMenuItem {
  readonly id?: string;
  readonly label: string;
  readonly disabled?: boolean;
  /** Nested flyout menu (hover). */
  readonly children?: readonly ContextMenuItem[];
}

export interface ContextMenuOptions {
  readonly x: number;
  readonly y: number;
  readonly items: readonly ContextMenuItem[];
  readonly onSelect: (id: string) => void;
}

/** Context menu with optional nested submenus (portal on document.body). */
export function showContextMenu(options: ContextMenuOptions): () => void {
  dismissOpenContextMenus();

  const root = document.createElement('div');
  root.className = 'ctx-menu';
  root.setAttribute('role', 'menu');
  root.tabIndex = -1;
  appendItems(root, options.items);
  document.body.appendChild(root);
  positionMenu(root, options.x, options.y);
  root.focus();

  const onSelect = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    const btn = target?.closest<HTMLButtonElement>('.ctx-menu-item');
    if (!btn || btn.disabled) return;
    if (btn.classList.contains('ctx-menu-parent')) return;
    const id = btn.dataset.id;
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
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
    if (root.contains(event.target as Node)) return;
    dispose();
  };

  root.addEventListener('click', onSelect);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('pointerdown', onPointerDown, true);

  function dispose(): void {
    root.removeEventListener('click', onSelect);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('pointerdown', onPointerDown, true);
    root.remove();
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

function appendItems(
  menu: HTMLElement,
  items: readonly ContextMenuItem[],
): void {
  for (const item of items) {
    if (item.children && item.children.length > 0) {
      const wrap = document.createElement('div');
      wrap.className = 'ctx-menu-submenu-wrap';

      const parentBtn = document.createElement('button');
      parentBtn.type = 'button';
      parentBtn.className = 'ctx-menu-item ctx-menu-parent';
      parentBtn.setAttribute('role', 'menuitem');
      parentBtn.setAttribute('aria-haspopup', 'true');
      parentBtn.disabled = Boolean(item.disabled);
      parentBtn.innerHTML = `${escapeHtml(item.label)}<span class="ctx-menu-caret" aria-hidden="true">▸</span>`;

      const childMenu = document.createElement('div');
      childMenu.className = 'ctx-menu ctx-submenu';
      childMenu.setAttribute('role', 'menu');
      appendItems(childMenu, item.children);

      wrap.appendChild(parentBtn);
      wrap.appendChild(childMenu);
      menu.appendChild(wrap);

      const placeSubmenu = (): void => {
        childMenu.classList.add('ctx-submenu-open');
        // Reset then measure against viewport.
        childMenu.style.left = '100%';
        childMenu.style.right = 'auto';
        childMenu.style.top = '0';
        const rect = childMenu.getBoundingClientRect();
        if (rect.right > window.innerWidth - 4) {
          childMenu.style.left = 'auto';
          childMenu.style.right = '100%';
        }
        if (rect.bottom > window.innerHeight - 4) {
          const overflow = rect.bottom - window.innerHeight + 4;
          childMenu.style.top = `${Math.max(-rect.top + 4, -overflow)}px`;
        }
      };

      wrap.addEventListener('pointerenter', placeSubmenu);
      wrap.addEventListener('pointerleave', () => {
        childMenu.classList.remove('ctx-submenu-open');
      });
      continue;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ctx-menu-item';
    btn.setAttribute('role', 'menuitem');
    btn.disabled = Boolean(item.disabled);
    if (item.id) btn.dataset.id = item.id;
    btn.textContent = item.label;
    menu.appendChild(btn);
  }
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
