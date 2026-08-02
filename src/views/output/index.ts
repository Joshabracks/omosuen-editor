/**
 * Output panel — nested State Street inside the `:preserve` dock host (2f).
 */

import { State } from '@state-street/state-street';

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

interface OutputData {
  lines: OutputLine[];
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

const template = /* html */ `
<div class="output-toolbar">
  <span class="output-title">Output</span>
  <button type="button" class="output-clear" title="Clear" aria-label="Clear" :click=clear()>Clear</button>
</div>
<EmptyHint/>
<OutputLog/>
`;

/** Pure HTML for one log line — unit-testable without mounting State. */
export function renderOutputLine(line: OutputLine): string {
  return (
    `<div class="output-line output-level-${escapeAttr(line.level)}" data-line-id="${escapeAttr(line.id)}">` +
    `<span class="output-level">${escapeHtml(line.level)}</span>` +
    `<span class="output-message">${escapeHtml(line.message)}</span>` +
    `</div>`
  );
}

export function mountOutput(container: HTMLElement): () => void {
  container.classList.add('output-panel');

  const initialLines = pending.splice(0);

  const scrollLog = (): void => {
    requestAnimationFrame(() => {
      const log = container.querySelector('.output-log') as HTMLElement | null;
      if (log) log.scrollTop = log.scrollHeight;
    });
  };

  const outputState = new State(
    template,
    { lines: initialLines } satisfies OutputData,
    {
      EmptyHint: ({ state }: { state: { data: OutputData } }) =>
        state.data.lines.length === 0
          ? `<div class="output-empty">No output yet</div>`
          : '',
      OutputLog: ({ state }: { state: { data: OutputData } }) => {
        if (state.data.lines.length === 0) return '';
        return (
          `<div class="output-log" role="log" aria-live="polite">` +
          state.data.lines.map(renderOutputLine).join('') +
          `</div>`
        );
      },
    },
    {
      clear: ({ state }: { state: { data: OutputData } }) => {
        state.data.lines = [];
      },
    },
    { mountTarget: container },
  ) as InstanceType<typeof State> & { data: OutputData };

  handle = {
    append(message, level = 'info') {
      outputState.data.lines = [
        ...outputState.data.lines,
        {
          id: `out-${nextLineId++}`,
          level,
          message,
          timestamp: Date.now(),
        },
      ];
      scrollLog();
    },
    clear() {
      outputState.data.lines = [];
    },
    lines: () => outputState.data.lines,
  };

  if (initialLines.length > 0) scrollLog();

  return () => {
    outputState.destroy();
    handle = null;
    container.classList.remove('output-panel');
    container.replaceChildren();
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
