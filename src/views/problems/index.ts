export const PROBLEMS_VIEW_ID = 'problems';

export type ProblemSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface ProblemDiagnostic {
  readonly id: string;
  readonly severity: ProblemSeverity;
  readonly message: string;
  readonly relativePath?: string;
  /** 1-based line when known. */
  readonly line?: number;
  /** 1-based column when known. */
  readonly column?: number;
  readonly source?: string;
}

export interface ProblemsDeps {
  readonly requestOpenLocation: (target: {
    readonly relativePath: string;
    readonly line?: number;
    readonly column?: number;
  }) => void;
}

export interface ProblemsHandle {
  readonly setProblems: (problems: readonly ProblemDiagnostic[]) => void;
  readonly clear: () => void;
  readonly problems: () => readonly ProblemDiagnostic[];
}

let handle: ProblemsHandle | null = null;

export function getProblemsHandle(): ProblemsHandle | null {
  return handle;
}

export function mountProblems(
  container: HTMLElement,
  deps: ProblemsDeps,
): () => void {
  container.classList.add('problems-panel');
  container.innerHTML = `
    <div class="problems-toolbar">
      <span class="problems-title">Problems</span>
      <button type="button" class="problems-clear" title="Clear" aria-label="Clear">Clear</button>
    </div>
    <div class="problems-empty" hidden>No problems</div>
    <div class="problems-list" role="list"></div>
  `;

  const clearBtn = container.querySelector(
    '.problems-clear',
  ) as HTMLButtonElement;
  const emptyEl = container.querySelector('.problems-empty') as HTMLElement;
  const listEl = container.querySelector('.problems-list') as HTMLElement;

  let problems: ProblemDiagnostic[] = [];

  function render(): void {
    emptyEl.hidden = problems.length > 0;
    listEl.hidden = problems.length === 0;
    listEl.innerHTML = problems
      .map((p) => {
        const loc = formatProblemLocation(p);
        const openable = p.relativePath ? ' problems-openable' : '';
        const pathAttr = p.relativePath
          ? ` data-rel="${escapeAttr(p.relativePath)}"`
          : '';
        const lineAttr =
          p.line !== undefined ? ` data-line="${p.line}"` : '';
        const colAttr =
          p.column !== undefined ? ` data-column="${p.column}"` : '';
        return `<button type="button" class="problems-row${openable}" role="listitem"${pathAttr}${lineAttr}${colAttr} ${p.relativePath ? '' : 'disabled'}>
          <span class="problems-severity problems-severity-${escapeAttr(p.severity)}">${escapeHtml(p.severity)}</span>
          <span class="problems-message">${escapeHtml(p.message)}</span>
          <span class="problems-loc">${escapeHtml(loc)}</span>
        </button>`;
      })
      .join('');
  }

  clearBtn.addEventListener('click', () => {
    problems = [];
    render();
  });

  listEl.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const row = target?.closest('.problems-row') as HTMLElement | null;
    if (!row?.dataset.rel) return;
    const line = row.dataset.line ? Number(row.dataset.line) : undefined;
    const column = row.dataset.column
      ? Number(row.dataset.column)
      : undefined;
    deps.requestOpenLocation({
      relativePath: row.dataset.rel,
      line: Number.isFinite(line) ? line : undefined,
      column: Number.isFinite(column) ? column : undefined,
    });
  });

  handle = {
    setProblems(next) {
      problems = [...next];
      render();
    },
    clear() {
      problems = [];
      render();
    },
    problems: () => problems,
  };

  render();

  return () => {
    handle = null;
  };
}

export function formatProblemLocation(p: ProblemDiagnostic): string {
  if (!p.relativePath) return p.source ?? '';
  const pos =
    p.line !== undefined
      ? p.column !== undefined
        ? `:${p.line}:${p.column}`
        : `:${p.line}`
      : '';
  const src = p.source ? ` · ${p.source}` : '';
  return `${p.relativePath}${pos}${src}`;
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
