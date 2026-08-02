/**
 * Problems panel — nested State Street inside the `:preserve` dock host (2f).
 */

import { State } from '@state-street/state-street';

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

interface ProblemsData {
  problems: ProblemDiagnostic[];
}

let handle: ProblemsHandle | null = null;

export function getProblemsHandle(): ProblemsHandle | null {
  return handle;
}

const template = /* html */ `
<div class="problems-toolbar">
  <span class="problems-title">Problems</span>
  <button type="button" class="problems-clear" title="Clear" aria-label="Clear" :click=clear()>Clear</button>
</div>
<EmptyHint/>
<ProblemsList/>
`;

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

/** Pure HTML for one problem row — unit-testable without mounting State. */
export function renderProblemRow(p: ProblemDiagnostic): string {
  const loc = formatProblemLocation(p);
  const openable = p.relativePath ? ' problems-openable' : '';
  const binding = p.relativePath
    ? ` :click=openProblem(id="${escapeAttr(p.id)}")`
    : ' disabled="disabled"';
  return (
    `<button type="button" class="problems-row${openable}" role="listitem"${binding}>` +
    `<span class="problems-severity problems-severity-${escapeAttr(p.severity)}">${escapeHtml(p.severity)}</span>` +
    `<span class="problems-message">${escapeHtml(p.message)}</span>` +
    `<span class="problems-loc">${escapeHtml(loc)}</span>` +
    `</button>`
  );
}

export function mountProblems(
  container: HTMLElement,
  deps: ProblemsDeps,
): () => void {
  container.classList.add('problems-panel');

  const problemsState = new State(
    template,
    { problems: [] } satisfies ProblemsData,
    {
      EmptyHint: ({ state }: { state: { data: ProblemsData } }) =>
        state.data.problems.length === 0
          ? `<div class="problems-empty">No problems</div>`
          : '',
      ProblemsList: ({ state }: { state: { data: ProblemsData } }) => {
        if (state.data.problems.length === 0) return '';
        return (
          `<div class="problems-list" role="list">` +
          state.data.problems.map(renderProblemRow).join('') +
          `</div>`
        );
      },
    },
    {
      clear: ({ state }: { state: { data: ProblemsData } }) => {
        state.data.problems = [];
      },
      openProblem: ({
        state,
        id,
      }: {
        state: { data: ProblemsData };
        id: string;
      }) => {
        const problem = state.data.problems.find((p) => p.id === String(id));
        if (!problem?.relativePath) return;
        deps.requestOpenLocation({
          relativePath: problem.relativePath,
          line: problem.line,
          column: problem.column,
        });
      },
    },
    { mountTarget: container },
  ) as InstanceType<typeof State> & { data: ProblemsData };

  handle = {
    setProblems(next) {
      problemsState.data.problems = [...next];
    },
    clear() {
      problemsState.data.problems = [];
    },
    problems: () => problemsState.data.problems,
  };

  return () => {
    problemsState.destroy();
    handle = null;
    container.classList.remove('problems-panel');
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
