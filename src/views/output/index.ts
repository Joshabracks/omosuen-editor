export const OUTPUT_VIEW_ID = 'output';

export type OutputLevel = 'debug' | 'info' | 'warn' | 'error';

export interface OutputLine {
  readonly id: string;
  readonly level: OutputLevel;
  readonly message: string;
  readonly timestamp: number;
}

export interface OutputHandle {
  readonly append: (message: string, level?: OutputLevel) => void;
  readonly clear: () => void;
  readonly lines: () => readonly OutputLine[];
}

let handle: OutputHandle | null = null;
let nextLineId = 1;

export function getOutputHandle(): OutputHandle | null {
  return handle;
}

/** Append even before the Output view mounts (buffered into the live handle once mounted). */
const pending: OutputLine[] = [];

export function appendOutput(
  message: string,
  level: OutputLevel = 'info',
): void {
  if (handle) {
    handle.append(message, level);
    return;
  }
  pending.push({
    id: `out-${nextLineId++}`,
    level,
    message,
    timestamp: Date.now(),
  });
}

export function mountOutput(container: HTMLElement): () => void {
  container.classList.add('output-panel');
  container.innerHTML = `
    <div class="output-toolbar">
      <span class="output-title">Output</span>
      <button type="button" class="output-clear" title="Clear" aria-label="Clear">Clear</button>
    </div>
    <div class="output-empty" hidden>No output yet</div>
    <div class="output-log" role="log" aria-live="polite"></div>
  `;

  const clearBtn = container.querySelector('.output-clear') as HTMLButtonElement;
  const emptyEl = container.querySelector('.output-empty') as HTMLElement;
  const logEl = container.querySelector('.output-log') as HTMLElement;

  const lines: OutputLine[] = pending.splice(0);

  function render(): void {
    emptyEl.hidden = lines.length > 0;
    logEl.hidden = lines.length === 0;
    logEl.innerHTML = lines
      .map(
        (line) =>
          `<div class="output-line output-level-${escapeAttr(line.level)}" data-line-id="${escapeAttr(line.id)}">
            <span class="output-level">${escapeHtml(line.level)}</span>
            <span class="output-message">${escapeHtml(line.message)}</span>
          </div>`,
      )
      .join('');
    logEl.scrollTop = logEl.scrollHeight;
  }

  clearBtn.addEventListener('click', () => {
    lines.length = 0;
    render();
  });

  handle = {
    append(message, level = 'info') {
      lines.push({
        id: `out-${nextLineId++}`,
        level,
        message,
        timestamp: Date.now(),
      });
      render();
    },
    clear() {
      lines.length = 0;
      render();
    },
    lines: () => lines,
  };

  render();

  return () => {
    handle = null;
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
